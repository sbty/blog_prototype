import { realpath } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { AppConfig } from "../config/env.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped } from "../system/stop.js";
import { parseJsonWithBom } from "../utils/json.js";
import { readArtifactFileInsideDirectory, writeJsonArtifactExclusive } from "./artifacts.js";
import { validateBrowserPreviewEvidence } from "./browserPreviewValidation.js";
import {
  assertScheduleApprovalIntegrity,
  calculateArtifactSha256
} from "./scheduleApprovalIntegrity.js";
import {
  assertSchedulePreviewMatchesPlan,
  assertScheduleQuotaPolicyMatchesReadiness,
  assertTimestampSequenceBeforeSchedule,
  scheduleApprovalArtifactSchema,
  schedulePlanArtifactSchema,
  schedulePreviewArtifactSchema,
  schedulePreviewConfirmationArtifactSchema
} from "./scheduleArtifactValidation.js";

export interface ScheduleExecutionPackage {
  artifactType: "schedule-execution-package";
  schemaVersion: 1;
  jobId: string;
  preparedAt: string;
  evidence: {
    planSha256: string;
    approvalSha256: string;
    previewSha256: string;
    previewConfirmationSha256: string;
    screenshotSha256: string;
  };
  evidenceChainValid: true;
  executionEnabled: false;
  executionAuthorized: false;
  bloggerMutationPerformed: false;
  requiresExternalExecutionImplementation: true;
}

export class ScheduleExecutionPackageService {
  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobRepository,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: {
    jobId: string;
    confirmation: string;
    previewConfirmationSha256: string;
  }): Promise<ScheduleExecutionPackage> {
    if (this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Execution package preparation requires ENABLE_DRAFT_SAVE=false and ENABLE_SCHEDULED_POST=false"
      );
    }
    if (input.confirmation !== input.jobId) {
      throw new Error("Execution package confirmation must exactly match the job ID");
    }
    if (!/^[a-f0-9]{64}$/.test(input.previewConfirmationSha256)) {
      throw new Error("Execution package preparation requires a lowercase SHA-256");
    }
    await assertNotStopped(this.config.DATA_DIR);
    const job = this.jobs.find(input.jobId);
    if (!job) throw new Error("Schedule job not found: " + input.jobId);
    if (job.mode !== "schedule" || job.status !== "PREVIEW_CONFIRMED") {
      throw new Error(
        `Schedule job must be PREVIEW_CONFIRMED for package preparation: ${job.mode}/${job.status}`
      );
    }

    const jobsRoot = await realpath(path.join(this.config.DATA_DIR, "jobs"));
    const artifactDir = await realpath(job.artifactDir);
    const relativeArtifactDir = path.relative(jobsRoot, artifactDir);
    if (relativeArtifactDir.startsWith("..") || path.isAbsolute(relativeArtifactDir)) {
      throw new Error("Schedule job artifact directory is outside DATA_DIR: " + job.artifactDir);
    }

    const [planBytes, approvalBytes, previewBytes, confirmationBytes] = await Promise.all([
      readArtifactFileInsideDirectory(artifactDir, "schedule-plan.json"),
      readArtifactFileInsideDirectory(artifactDir, "schedule-approval.json"),
      readArtifactFileInsideDirectory(artifactDir, "schedule-browser-preview.json"),
      readArtifactFileInsideDirectory(artifactDir, "schedule-preview-confirmation.json")
    ]).catch(() => {
      throw new Error("Schedule execution package evidence is missing");
    });

    let plan: ReturnType<typeof schedulePlanArtifactSchema.parse>;
    let approval: ReturnType<typeof scheduleApprovalArtifactSchema.parse>;
    let preview: ReturnType<typeof schedulePreviewArtifactSchema.parse>;
    let confirmation: ReturnType<typeof schedulePreviewConfirmationArtifactSchema.parse>;
    try {
      plan = schedulePlanArtifactSchema.parse(
        parseJsonWithBom(Buffer.from(planBytes).toString("utf8"))
      );
      approval = scheduleApprovalArtifactSchema.parse(
        parseJsonWithBom(Buffer.from(approvalBytes).toString("utf8"))
      );
      preview = schedulePreviewArtifactSchema.parse(
        parseJsonWithBom(Buffer.from(previewBytes).toString("utf8"))
      );
      confirmation = schedulePreviewConfirmationArtifactSchema.parse(
        parseJsonWithBom(Buffer.from(confirmationBytes).toString("utf8"))
      );
    } catch {
      throw new Error("Schedule execution package evidence is invalid");
    }

    const planSha256 = calculateArtifactSha256(planBytes);
    const approvalSha256 = calculateArtifactSha256(approvalBytes);
    const previewSha256 = calculateArtifactSha256(previewBytes);
    const previewConfirmationSha256 = calculateArtifactSha256(confirmationBytes);
    if (previewConfirmationSha256 !== input.previewConfirmationSha256) {
      throw new Error("Schedule preview confirmation SHA-256 does not match");
    }
    if (
      approval.jobId !== input.jobId ||
      preview.jobId !== input.jobId ||
      preview.readiness.jobId !== input.jobId ||
      confirmation.jobId !== input.jobId ||
      approval.planSha256 !== planSha256 ||
      preview.readiness.planSha256 !== planSha256 ||
      preview.evidence.planSha256 !== planSha256 ||
      preview.evidence.approvalSha256 !== approvalSha256 ||
      confirmation.previewSha256 !== previewSha256
    ) {
      throw new Error("Schedule execution package evidence chain does not match");
    }
    assertScheduleQuotaPolicyMatchesReadiness(
      plan,
      preview.readiness,
      "Schedule execution package evidence chain does not match"
    );
    assertSchedulePreviewMatchesPlan(
      plan,
      preview,
      "Schedule execution package evidence chain does not match"
    );
    assertScheduleApprovalIntegrity({
      jobId: input.jobId,
      planText: Buffer.from(planBytes).toString("utf8"),
      approval
    });
    const screenshotBytes = await validateBrowserPreviewEvidence(preview.dryRun, artifactDir);
    const screenshotSha256 = calculateArtifactSha256(screenshotBytes);
    if (preview.evidence.screenshotSha256 !== screenshotSha256) {
      throw new Error("Schedule execution package screenshot evidence has changed");
    }
    const preparedAt = this.now();
    assertTimestampSequenceBeforeSchedule(
      [
        approval.approvedAt,
        preview.readiness.checkedAt,
        preview.evidence.previewedAt,
        confirmation.confirmedAt,
        preparedAt.toISOString()
      ],
      plan.scheduledAt,
      "Schedule execution package evidence has an invalid timestamp order"
    );

    const result: ScheduleExecutionPackage = {
      artifactType: "schedule-execution-package",
      schemaVersion: 1,
      jobId: input.jobId,
      preparedAt: preparedAt.toISOString(),
      evidence: {
        planSha256,
        approvalSha256,
        previewSha256,
        previewConfirmationSha256,
        screenshotSha256
      },
      evidenceChainValid: true,
      executionEnabled: false,
      executionAuthorized: false,
      bloggerMutationPerformed: false,
      requiresExternalExecutionImplementation: true
    };
    await assertNotStopped(this.config.DATA_DIR);
    await writeJsonArtifactExclusive(
      path.join(artifactDir, "schedule-execution-package.json"),
      result
    );
    this.jobs.addEvent(
      input.jobId,
      "SCHEDULE_EXECUTION_PACKAGE_PREPARED",
      "Non-executing schedule package prepared locally",
      result
    );
    this.logger.info({ jobId: input.jobId, artifactDir }, "Schedule execution package prepared");
    return result;
  }
}
