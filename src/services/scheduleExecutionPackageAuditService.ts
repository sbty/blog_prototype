import { realpath } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { AppConfig } from "../config/env.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped } from "../system/stop.js";
import { parseJsonWithBom } from "../utils/json.js";
import { validateBrowserPreviewEvidence } from "./browserPreviewValidation.js";
import { readArtifactFileInsideDirectory, writeJsonArtifactExclusive } from "./artifacts.js";
import { calculateArtifactSha256 } from "./scheduleApprovalIntegrity.js";
import {
  assertSchedulePreviewMatchesPlan,
  assertScheduleQuotaPolicyMatchesReadiness,
  assertTimestampSequenceBeforeSchedule,
  scheduleApprovalArtifactSchema,
  scheduleExecutionPackageArtifactSchema,
  schedulePlanArtifactSchema,
  schedulePreviewArtifactSchema,
  schedulePreviewConfirmationArtifactSchema
} from "./scheduleArtifactValidation.js";

export interface ScheduleExecutionPackageAudit {
  artifactType: "schedule-execution-package-audit";
  schemaVersion: 1;
  jobId: string;
  auditedAt: string;
  packageSha256: string;
  evidenceChainValid: true;
  executionEnabled: false;
  executionAuthorized: false;
  bloggerMutationPerformed: false;
}

export class ScheduleExecutionPackageAuditService {
  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobRepository,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: {
    jobId: string;
    packageSha256: string;
  }): Promise<ScheduleExecutionPackageAudit> {
    if (this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Execution package audit requires ENABLE_DRAFT_SAVE=false and ENABLE_SCHEDULED_POST=false"
      );
    }
    if (!/^[a-f0-9]{64}$/.test(input.packageSha256)) {
      throw new Error("Execution package audit requires a lowercase SHA-256");
    }
    await assertNotStopped(this.config.DATA_DIR);
    const job = this.jobs.find(input.jobId);
    if (!job) throw new Error("Schedule job not found: " + input.jobId);
    if (job.mode !== "schedule" || job.status !== "PREVIEW_CONFIRMED") {
      throw new Error(
        `Schedule job must be PREVIEW_CONFIRMED for package audit: ${job.mode}/${job.status}`
      );
    }

    const jobsRoot = await realpath(path.join(this.config.DATA_DIR, "jobs"));
    const artifactDir = await realpath(job.artifactDir);
    const relativeArtifactDir = path.relative(jobsRoot, artifactDir);
    if (relativeArtifactDir.startsWith("..") || path.isAbsolute(relativeArtifactDir)) {
      throw new Error("Schedule job artifact directory is outside DATA_DIR: " + job.artifactDir);
    }
    const names = [
      "schedule-plan.json",
      "schedule-approval.json",
      "schedule-browser-preview.json",
      "schedule-preview-confirmation.json",
      "schedule-execution-package.json"
    ] as const;
    const bytes = await Promise.all(
      names.map((name) => readArtifactFileInsideDirectory(artifactDir, name))
    ).catch(() => {
      throw new Error("Schedule execution package audit evidence is missing");
    });
    const [planBytes, approvalBytes, previewBytes, confirmationBytes, packageBytes] = bytes;
    const actualPackageSha256 = calculateArtifactSha256(packageBytes);
    if (actualPackageSha256 !== input.packageSha256) {
      throw new Error("Schedule execution package SHA-256 does not match");
    }

    let plan: ReturnType<typeof schedulePlanArtifactSchema.parse>;
    let approval: ReturnType<typeof scheduleApprovalArtifactSchema.parse>;
    let preview: ReturnType<typeof schedulePreviewArtifactSchema.parse>;
    let confirmation: ReturnType<typeof schedulePreviewConfirmationArtifactSchema.parse>;
    let executionPackage: ReturnType<typeof scheduleExecutionPackageArtifactSchema.parse>;
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
      executionPackage = scheduleExecutionPackageArtifactSchema.parse(
        parseJsonWithBom(Buffer.from(packageBytes).toString("utf8"))
      );
    } catch {
      throw new Error("Schedule execution package audit evidence is invalid");
    }
    const screenshotBytes = await validateBrowserPreviewEvidence(preview.dryRun, artifactDir);
    const hashes = {
      planSha256: calculateArtifactSha256(planBytes),
      approvalSha256: calculateArtifactSha256(approvalBytes),
      previewSha256: calculateArtifactSha256(previewBytes),
      previewConfirmationSha256: calculateArtifactSha256(confirmationBytes),
      screenshotSha256: calculateArtifactSha256(screenshotBytes)
    };
    if (
      executionPackage.jobId !== input.jobId ||
      approval.jobId !== input.jobId ||
      preview.jobId !== input.jobId ||
      preview.readiness.jobId !== input.jobId ||
      confirmation.jobId !== input.jobId ||
      JSON.stringify(executionPackage.evidence) !== JSON.stringify(hashes) ||
      approval.planSha256 !== hashes.planSha256 ||
      preview.readiness.planSha256 !== hashes.planSha256 ||
      preview.evidence.planSha256 !== hashes.planSha256 ||
      preview.evidence.approvalSha256 !== hashes.approvalSha256 ||
      preview.evidence.screenshotSha256 !== hashes.screenshotSha256 ||
      confirmation.previewSha256 !== hashes.previewSha256
    ) {
      throw new Error("Schedule execution package audit evidence chain does not match");
    }
    assertScheduleQuotaPolicyMatchesReadiness(
      plan,
      preview.readiness,
      "Schedule execution package audit evidence chain does not match"
    );
    assertSchedulePreviewMatchesPlan(
      plan,
      preview,
      "Schedule execution package audit evidence chain does not match"
    );
    const auditedAt = this.now();
    assertTimestampSequenceBeforeSchedule(
      [
        approval.approvedAt,
        preview.readiness.checkedAt,
        preview.evidence.previewedAt,
        confirmation.confirmedAt,
        executionPackage.preparedAt,
        auditedAt.toISOString()
      ],
      plan.scheduledAt,
      "Schedule execution package audit evidence has an invalid timestamp order"
    );
    await assertNotStopped(this.config.DATA_DIR);
    const result: ScheduleExecutionPackageAudit = {
      artifactType: "schedule-execution-package-audit",
      schemaVersion: 1,
      jobId: input.jobId,
      auditedAt: auditedAt.toISOString(),
      packageSha256: actualPackageSha256,
      evidenceChainValid: true,
      executionEnabled: false,
      executionAuthorized: false,
      bloggerMutationPerformed: false
    };
    await writeJsonArtifactExclusive(
      path.join(artifactDir, "schedule-execution-package-audit.json"),
      result
    );
    this.jobs.addEvent(
      input.jobId,
      "SCHEDULE_EXECUTION_PACKAGE_AUDITED",
      "Non-executing schedule package audited locally",
      result
    );
    this.logger.info({ jobId: input.jobId, artifactDir }, "Schedule execution package audited");
    return result;
  }
}
