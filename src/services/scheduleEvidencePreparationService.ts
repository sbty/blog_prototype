import type { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped } from "../system/stop.js";
import type { AppConfig } from "../config/env.js";
import { readArtifactFileInsideDirectory } from "./artifacts.js";
import { calculateArtifactSha256 } from "./scheduleApprovalIntegrity.js";

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

    const preview = await this.stages.preview.execute({ jobId: input.jobId });
    await this.stages.confirm.execute({
      jobId: input.jobId,
      confirmation: input.confirmation,
      previewSha256: preview.previewArtifactSha256
    });
    const previewConfirmationSha256 = await this.hashArtifact(
      job.artifactDir,
      "schedule-preview-confirmation.json"
    );

    await this.stages.preparePackage.execute({
      jobId: input.jobId,
      confirmation: input.confirmation,
      previewConfirmationSha256
    });
    const packageSha256 = await this.hashArtifact(
      job.artifactDir,
      "schedule-execution-package.json"
    );

    await this.stages.auditPackage.execute({ jobId: input.jobId, packageSha256 });
    const auditSha256 = await this.hashArtifact(
      job.artifactDir,
      "schedule-execution-package-audit.json"
    );
    return {
      previewSha256: preview.previewArtifactSha256,
      previewConfirmationSha256,
      packageSha256,
      auditSha256
    };
  }

  private async hashArtifact(artifactDir: string, fileName: string): Promise<string> {
    await assertNotStopped(this.config.DATA_DIR);
    return calculateArtifactSha256(await readArtifactFileInsideDirectory(artifactDir, fileName));
  }
}
