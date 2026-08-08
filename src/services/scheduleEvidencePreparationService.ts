import type { AppConfig } from "../config/env.js";
import type { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped } from "../system/stop.js";
import { parseJsonWithBom } from "../utils/json.js";
import { readArtifactFileInsideDirectory } from "./artifacts.js";
import { calculateArtifactSha256 } from "./scheduleApprovalIntegrity.js";
import {
  scheduleExecutionPackageArtifactSchema,
  scheduleExecutionPackageAuditArtifactSchema,
  schedulePreviewArtifactSchema,
  schedulePreviewConfirmationArtifactSchema
} from "./scheduleArtifactValidation.js";

export interface SchedulePreparationEvidence {
  previewSha256: string;
  previewConfirmationSha256: string;
  packageSha256: string;
  auditSha256: string;
}

interface PreviewStage {
  execute(input: { jobId: string }): Promise<{ previewArtifactSha256: string }>;
}
interface ConfirmationStage {
  execute(input: { jobId: string; confirmation: string; previewSha256: string }): Promise<unknown>;
}
interface PackageStage {
  execute(input: {
    jobId: string;
    confirmation: string;
    previewConfirmationSha256: string;
  }): Promise<unknown>;
}
interface AuditStage {
  execute(input: { jobId: string; packageSha256: string }): Promise<unknown>;
}

export class ScheduleEvidencePreparationService {
  constructor(
    private readonly config: AppConfig,
    private readonly jobs: Pick<JobRepository, "find">,
    private readonly stages: {
      preview: PreviewStage;
      confirm: ConfirmationStage;
      preparePackage: PackageStage;
      auditPackage: AuditStage;
    }
  ) {}

  async execute(input: {
    jobId: string;
    confirmation: string;
  }): Promise<SchedulePreparationEvidence> {
    if (this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Schedule evidence preparation requires ENABLE_DRAFT_SAVE=false and ENABLE_SCHEDULED_POST=false"
      );
    }
    if (input.confirmation !== input.jobId) {
      throw new Error("Schedule evidence preparation confirmation must exactly match the job ID");
    }
    await assertNotStopped(this.config.DATA_DIR);
    const job = this.jobs.find(input.jobId);
    if (!job) throw new Error(`Schedule job not found: ${input.jobId}`);
    if (job.mode !== "schedule") throw new Error("Evidence preparation requires a schedule job");

    let previewSha256: string;
    let previewConfirmationSha256: string;
    if (job.status === "APPROVED_FOR_POST") {
      const preview = await this.stages.preview.execute({ jobId: input.jobId });
      previewSha256 = preview.previewArtifactSha256;
      await this.stages.confirm.execute({
        jobId: input.jobId,
        confirmation: input.confirmation,
        previewSha256
      });
      previewConfirmationSha256 = await this.hashArtifact(
        job.artifactDir,
        "schedule-preview-confirmation.json"
      );
    } else if (job.status === "PREVIEW_CONFIRMED") {
      const previewBytes = await readArtifactFileInsideDirectory(
        job.artifactDir,
        "schedule-browser-preview.json"
      );
      const confirmationBytes = await readArtifactFileInsideDirectory(
        job.artifactDir,
        "schedule-preview-confirmation.json"
      );
      const preview = schedulePreviewArtifactSchema.parse(
        parseJsonWithBom(Buffer.from(previewBytes).toString("utf8"))
      );
      const confirmation = schedulePreviewConfirmationArtifactSchema.parse(
        parseJsonWithBom(Buffer.from(confirmationBytes).toString("utf8"))
      );
      previewSha256 = calculateArtifactSha256(previewBytes);
      previewConfirmationSha256 = calculateArtifactSha256(confirmationBytes);
      if (
        preview.jobId !== input.jobId ||
        confirmation.jobId !== input.jobId ||
        confirmation.previewSha256 !== previewSha256
      ) {
        throw new Error("Existing schedule preview evidence does not match the resumed job");
      }
    } else {
      throw new Error(`Schedule evidence preparation cannot resume from job status: ${job.status}`);
    }

    const existingPackage = await this.readOptionalArtifact(
      job.artifactDir,
      "schedule-execution-package.json"
    );
    let packageSha256: string;
    if (existingPackage) {
      const executionPackage = scheduleExecutionPackageArtifactSchema.parse(
        parseJsonWithBom(Buffer.from(existingPackage).toString("utf8"))
      );
      if (
        executionPackage.jobId !== input.jobId ||
        executionPackage.evidence.previewConfirmationSha256 !== previewConfirmationSha256
      ) {
        throw new Error("Existing execution package does not match the resumed job");
      }
      packageSha256 = calculateArtifactSha256(existingPackage);
    } else {
      await this.stages.preparePackage.execute({
        jobId: input.jobId,
        confirmation: input.confirmation,
        previewConfirmationSha256
      });
      packageSha256 = await this.hashArtifact(job.artifactDir, "schedule-execution-package.json");
    }

    const existingAudit = await this.readOptionalArtifact(
      job.artifactDir,
      "schedule-execution-package-audit.json"
    );
    let auditSha256: string;
    if (existingAudit) {
      const audit = scheduleExecutionPackageAuditArtifactSchema.parse(
        parseJsonWithBom(Buffer.from(existingAudit).toString("utf8"))
      );
      if (audit.jobId !== input.jobId || audit.packageSha256 !== packageSha256) {
        throw new Error("Existing execution package audit does not match the resumed job");
      }
      auditSha256 = calculateArtifactSha256(existingAudit);
    } else {
      await this.stages.auditPackage.execute({ jobId: input.jobId, packageSha256 });
      auditSha256 = await this.hashArtifact(
        job.artifactDir,
        "schedule-execution-package-audit.json"
      );
    }
    return { previewSha256, previewConfirmationSha256, packageSha256, auditSha256 };
  }

  private async hashArtifact(artifactDir: string, fileName: string): Promise<string> {
    await assertNotStopped(this.config.DATA_DIR);
    return calculateArtifactSha256(await readArtifactFileInsideDirectory(artifactDir, fileName));
  }

  private async readOptionalArtifact(
    artifactDir: string,
    fileName: string
  ): Promise<Buffer | null> {
    await assertNotStopped(this.config.DATA_DIR);
    try {
      return await readArtifactFileInsideDirectory(artifactDir, fileName);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
