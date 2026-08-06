import { realpath } from "node:fs/promises";
import { writeJsonArtifactAtomic } from "./artifacts.js";
import path from "node:path";
import type { Logger } from "pino";
import type { AppConfig } from "../config/env.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped } from "../system/stop.js";

export interface ScheduleCancellation {
  jobId: string;
  previousStatus: "READY_FOR_POST" | "APPROVED_FOR_POST" | "PREVIEW_CONFIRMED";
  cancelledAt: string;
  confirmationMatched: true;
  bloggerMutationPerformed: false;
}

export class ScheduleCancellationService {
  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobRepository,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: { jobId: string; confirmation: string }): Promise<ScheduleCancellation> {
    if (this.config.ENABLE_SCHEDULED_POST) {
      throw new Error("Local schedule cancellation requires ENABLE_SCHEDULED_POST=false");
    }
    if (input.confirmation !== input.jobId) {
      throw new Error("Schedule cancellation confirmation must exactly match the job ID");
    }
    await assertNotStopped(this.config.DATA_DIR);
    const job = this.jobs.find(input.jobId);
    if (!job) throw new Error(`Schedule job not found: ${input.jobId}`);
    if (
      job.mode !== "schedule" ||
      (job.status !== "READY_FOR_POST" &&
        job.status !== "APPROVED_FOR_POST" &&
        job.status !== "PREVIEW_CONFIRMED")
    ) {
      throw new Error(
        `Schedule job must be READY_FOR_POST, APPROVED_FOR_POST, or PREVIEW_CONFIRMED for cancellation: ${job.mode}/${job.status}`
      );
    }

    const jobsRoot = await realpath(path.join(this.config.DATA_DIR, "jobs"));
    const artifactDir = await realpath(job.artifactDir);
    const relativeArtifactDir = path.relative(jobsRoot, artifactDir);
    if (relativeArtifactDir.startsWith("..") || path.isAbsolute(relativeArtifactDir)) {
      throw new Error(`Schedule job artifact directory is outside DATA_DIR: ${job.artifactDir}`);
    }

    const cancellation: ScheduleCancellation = {
      jobId: input.jobId,
      previousStatus: job.status,
      cancelledAt: this.now().toISOString(),
      confirmationMatched: true,
      bloggerMutationPerformed: false
    };
    await assertNotStopped(this.config.DATA_DIR);
    await writeJsonArtifactAtomic(path.join(artifactDir, "schedule-cancellation.json"), cancellation);
    this.jobs.updateStatus(input.jobId, "CANCELLED", "Schedule plan cancelled locally", cancellation);
    this.logger.info({ jobId: input.jobId, artifactDir }, "Local schedule plan cancelled");
    return cancellation;
  }
}