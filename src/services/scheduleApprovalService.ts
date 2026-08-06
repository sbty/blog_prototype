import { realpath } from "node:fs/promises";
import {
  readArtifactFileInsideDirectory,
  writeJsonArtifactAtomic
} from "./artifacts.js";
import path from "node:path";
import type { Logger } from "pino";
import { prepareSchedulePreview } from "../browser/bloggerSchedulePreview.js";
import type { AppConfig } from "../config/env.js";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped } from "../system/stop.js";
import { parseJsonWithBom } from "../utils/json.js";
import { calculateSchedulePlanSha256 } from "./scheduleApprovalIntegrity.js";
import { schedulePlanArtifactSchema } from "./scheduleArtifactValidation.js";
import type { SchedulePlan } from "./schedulePlanService.js";

export interface ScheduleApproval {
  jobId: string;
  approvedAt: string;
  confirmationMatched: true;
  bloggerMutationPerformed: false;
  planSha256: string;
}

export class ScheduleApprovalService {
  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobRepository,
    private readonly articles: ArticleRepository,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: { jobId: string; confirmation: string }): Promise<ScheduleApproval> {
    if (this.config.ENABLE_SCHEDULED_POST) {
      throw new Error("Local schedule approval requires ENABLE_SCHEDULED_POST=false");
    }
    if (input.confirmation !== input.jobId) {
      throw new Error("Schedule approval confirmation must exactly match the job ID");
    }
    await assertNotStopped(this.config.DATA_DIR);
    const job = this.jobs.find(input.jobId);
    if (!job) throw new Error(`Schedule job not found: ${input.jobId}`);
    if (job.mode !== "schedule" || job.status !== "READY_FOR_POST") {
      throw new Error(
        `Schedule job must be READY_FOR_POST before approval: ${job.mode}/${job.status}`
      );
    }

    const jobsRoot = await realpath(path.join(this.config.DATA_DIR, "jobs"));
    const artifactDir = await realpath(job.artifactDir);
    const relativeArtifactDir = path.relative(jobsRoot, artifactDir);
    if (relativeArtifactDir.startsWith("..") || path.isAbsolute(relativeArtifactDir)) {
      throw new Error(`Schedule job artifact directory is outside DATA_DIR: ${job.artifactDir}`);
    }
    const planPath = path.join(artifactDir, "schedule-plan.json");
    let plan: SchedulePlan;
    let planText: string;
    try {
      planText = Buffer.from(
        await readArtifactFileInsideDirectory(artifactDir, "schedule-plan.json")
      ).toString("utf8");
      plan = schedulePlanArtifactSchema.parse(parseJsonWithBom<unknown>(planText));
    } catch {
      throw new Error(`Schedule plan artifact is missing or invalid: ${planPath}`);
    }

    const approvedAt = this.now();
    const expectedPreview = prepareSchedulePreview(
      plan.scheduledAt,
      this.config.APP_TIMEZONE,
      approvedAt
    );
    if (
      plan.date !== expectedPreview.date ||
      plan.time !== expectedPreview.time ||
      plan.timezone !== expectedPreview.timezone
    ) {
      throw new Error("Schedule plan display time does not match scheduledAt");
    }
    const storedSchedule = this.articles.findScheduleByJobId(input.jobId);
    if (!storedSchedule || storedSchedule.blogKey !== job.blogKey) {
      throw new Error("Schedule plan is missing its database article record");
    }
    if (
      new Date(storedSchedule.scheduledAt).toISOString() !==
      new Date(plan.scheduledAt).toISOString()
    ) {
      throw new Error("Schedule plan time does not match its database article record");
    }
    await assertNotStopped(this.config.DATA_DIR);

    const approval: ScheduleApproval = {
      jobId: input.jobId,
      approvedAt: approvedAt.toISOString(),
      confirmationMatched: true,
      bloggerMutationPerformed: false,
      planSha256: calculateSchedulePlanSha256(planText)
    };
    await writeJsonArtifactAtomic(path.join(artifactDir, "schedule-approval.json"), approval);
    this.jobs.updateStatus(
      input.jobId,
      "APPROVED_FOR_POST",
      "Schedule plan approved locally",
      approval
    );
    this.logger.info({ jobId: input.jobId, artifactDir }, "Local schedule plan approved");
    return approval;
  }
}