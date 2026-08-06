import { realpath } from "node:fs/promises";
import { readArtifactFileInsideDirectory, writeJsonArtifactAtomic } from "./artifacts.js";
import path from "node:path";
import type { Logger } from "pino";
import type { AppConfig } from "../config/env.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped } from "../system/stop.js";
import { parseJsonWithBom } from "../utils/json.js";
import { validateBrowserPreviewEvidence } from "./browserPreviewValidation.js";
import {
  assertScheduleApprovalIntegrity,
  calculateArtifactSha256
} from "./scheduleApprovalIntegrity.js";
import type { ScheduleApproval } from "./scheduleApprovalService.js";
import {
  assertSchedulePreviewMatchesPlan,
  assertScheduleQuotaPolicyMatchesReadiness,
  assertTimestampSequenceBeforeSchedule,
  scheduleApprovalArtifactSchema,
  schedulePlanArtifactSchema,
  schedulePreviewArtifactSchema
} from "./scheduleArtifactValidation.js";

export interface SchedulePreviewConfirmation {
  artifactType: "schedule-preview-confirmation";
  schemaVersion: 1;
  jobId: string;
  confirmedAt: string;
  previewSha256: string;
  confirmationMatched: true;
  executionEnabled: false;
  executionAuthorized: false;
  bloggerMutationPerformed: false;
}

export class SchedulePreviewConfirmationService {
  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobRepository,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: {
    jobId: string;
    confirmation: string;
    previewSha256: string;
  }): Promise<SchedulePreviewConfirmation> {
    if (this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Preview confirmation requires ENABLE_DRAFT_SAVE=false and ENABLE_SCHEDULED_POST=false"
      );
    }
    if (input.confirmation !== input.jobId) {
      throw new Error("Preview confirmation must exactly match the job ID");
    }
    if (!/^[a-f0-9]{64}$/.test(input.previewSha256)) {
      throw new Error("Preview confirmation requires a lowercase SHA-256");
    }
    await assertNotStopped(this.config.DATA_DIR);
    const job = this.jobs.find(input.jobId);
    if (!job) throw new Error("Schedule job not found: " + input.jobId);
    if (job.mode !== "schedule" || job.status !== "APPROVED_FOR_POST") {
      throw new Error(
        "Schedule job must be APPROVED_FOR_POST for preview confirmation: " +
          job.mode +
          "/" +
          job.status
      );
    }

    const jobsRoot = await realpath(path.join(this.config.DATA_DIR, "jobs"));
    const artifactDir = await realpath(job.artifactDir);
    const relativeArtifactDir = path.relative(jobsRoot, artifactDir);
    if (relativeArtifactDir.startsWith("..") || path.isAbsolute(relativeArtifactDir)) {
      throw new Error("Schedule job artifact directory is outside DATA_DIR: " + job.artifactDir);
    }
    const previewPath = path.join(artifactDir, "schedule-browser-preview.json");
    let previewBytes: Uint8Array;
    let preview: ReturnType<typeof schedulePreviewArtifactSchema.parse>;
    try {
      previewBytes = await readArtifactFileInsideDirectory(
        artifactDir,
        "schedule-browser-preview.json"
      );
      preview = schedulePreviewArtifactSchema.parse(
        parseJsonWithBom<unknown>(Buffer.from(previewBytes).toString("utf8"))
      );
    } catch {
      throw new Error("Schedule browser preview artifact is missing or invalid: " + previewPath);
    }
    const actualPreviewSha256 = calculateArtifactSha256(previewBytes);
    if (actualPreviewSha256 !== input.previewSha256) {
      throw new Error("Schedule browser preview SHA-256 does not match confirmation");
    }
    if (
      preview.jobId !== input.jobId ||
      preview.readiness.jobId !== input.jobId ||
      preview.bloggerMutationPerformed !== false ||
      preview.readiness.executionEnabled !== false
    ) {
      throw new Error("Schedule browser preview is not a valid non-executing preview");
    }
    const confirmedAt = this.now();

    const screenshotBytes = await validateBrowserPreviewEvidence(preview.dryRun, artifactDir);
    const [planBytes, approvalBytes] = await Promise.all([
      readArtifactFileInsideDirectory(artifactDir, "schedule-plan.json"),
      readArtifactFileInsideDirectory(artifactDir, "schedule-approval.json")
    ]);
    const planSha256 = calculateArtifactSha256(planBytes);
    if (
      preview.evidence.planSha256 !== planSha256 ||
      preview.readiness.planSha256 !== planSha256 ||
      preview.evidence.approvalSha256 !== calculateArtifactSha256(approvalBytes) ||
      preview.evidence.screenshotSha256 !== calculateArtifactSha256(screenshotBytes)
    ) {
      throw new Error("Schedule browser preview evidence has changed since preview");
    }
    let approval: ScheduleApproval;
    let plan: ReturnType<typeof schedulePlanArtifactSchema.parse>;
    try {
      plan = schedulePlanArtifactSchema.parse(
        parseJsonWithBom<unknown>(Buffer.from(planBytes).toString("utf8"))
      );
      approval = scheduleApprovalArtifactSchema.parse(
        parseJsonWithBom<unknown>(Buffer.from(approvalBytes).toString("utf8"))
      );
    } catch {
      throw new Error("Schedule approval artifact is invalid");
    }
    assertScheduleApprovalIntegrity({
      jobId: input.jobId,
      planText: Buffer.from(planBytes).toString("utf8"),
      approval
    });
    assertScheduleQuotaPolicyMatchesReadiness(plan, preview.readiness);
    assertSchedulePreviewMatchesPlan(
      plan,
      preview,
      "Schedule browser preview does not match the approved schedule plan"
    );
    assertTimestampSequenceBeforeSchedule(
      [
        approval.approvedAt,
        preview.readiness.checkedAt,
        preview.evidence.previewedAt,
        confirmedAt.toISOString()
      ],
      plan.scheduledAt,
      "Schedule browser preview evidence has an invalid timestamp order"
    );
    await assertNotStopped(this.config.DATA_DIR);

    const confirmation: SchedulePreviewConfirmation = {
      artifactType: "schedule-preview-confirmation",
      schemaVersion: 1,
      jobId: input.jobId,
      confirmedAt: confirmedAt.toISOString(),
      previewSha256: actualPreviewSha256,
      confirmationMatched: true,
      executionEnabled: false,
      executionAuthorized: false,
      bloggerMutationPerformed: false
    };
    await writeJsonArtifactAtomic(
      path.join(artifactDir, "schedule-preview-confirmation.json"),
      confirmation
    );
    this.jobs.updateStatus(
      input.jobId,
      "PREVIEW_CONFIRMED",
      "Schedule browser preview confirmed locally",
      confirmation
    );
    this.logger.info({ jobId: input.jobId, artifactDir }, "Schedule browser preview confirmed");
    return confirmation;
  }
}
