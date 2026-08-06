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
import { BlogRepository } from "../repositories/blogRepository.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped } from "../system/stop.js";
import { parseJsonWithBom } from "../utils/json.js";
import {
  assertScheduleApprovalIntegrity,
  calculateSchedulePlanSha256
} from "./scheduleApprovalIntegrity.js";
import type { ScheduleApproval } from "./scheduleApprovalService.js";
import type { SchedulePlan } from "./schedulePlanService.js";
import {
  scheduleApprovalArtifactSchema,
  schedulePlanArtifactSchema
} from "./scheduleArtifactValidation.js";
export interface ScheduleReadinessResult {
  jobId: string;
  checkedAt: string;
  planSha256: string;
  localChecksPassed: true;
  executionEnabled: false;
  executionAuthorized: false;
  bloggerMutationPerformed: false;
  quota: { systemCount: number; systemLimit: number; blogCount: number; blogLimit: number };
}

export class ScheduleReadinessService {
  constructor(
    private readonly config: AppConfig,
    private readonly repos: {
      jobs: JobRepository;
      articles: ArticleRepository;
      blogs: BlogRepository;
    },
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: { jobId: string }): Promise<ScheduleReadinessResult> {
    if (this.config.ENABLE_SCHEDULED_POST) {
      throw new Error("Local readiness check requires ENABLE_SCHEDULED_POST=false");
    }
    await assertNotStopped(this.config.DATA_DIR);
    const job = this.repos.jobs.find(input.jobId);
    if (!job) throw new Error(`Schedule job not found: ${input.jobId}`);
    if (job.mode !== "schedule" || job.status !== "APPROVED_FOR_POST") {
      throw new Error(
        `Schedule job must be APPROVED_FOR_POST for readiness check: ${job.mode}/${job.status}`
      );
    }

    const jobsRoot = await realpath(path.join(this.config.DATA_DIR, "jobs"));
    const artifactDir = await realpath(job.artifactDir);
    const relativeArtifactDir = path.relative(jobsRoot, artifactDir);
    if (relativeArtifactDir.startsWith("..") || path.isAbsolute(relativeArtifactDir)) {
      throw new Error(`Schedule job artifact directory is outside DATA_DIR: ${job.artifactDir}`);
    }

    let planText: string;
    let planValue: unknown;
    let approval: ScheduleApproval;
    try {
      planText = Buffer.from(
        await readArtifactFileInsideDirectory(artifactDir, "schedule-plan.json")
      ).toString("utf8");
      planValue = parseJsonWithBom<unknown>(planText);
      approval = scheduleApprovalArtifactSchema.parse(
        parseJsonWithBom<unknown>(
          Buffer.from(
            await readArtifactFileInsideDirectory(artifactDir, "schedule-approval.json")
          ).toString("utf8")
        )
      );
    } catch {
      throw new Error("Schedule plan or approval artifact is missing or invalid");
    }
    assertScheduleApprovalIntegrity({ jobId: input.jobId, planText, approval });
    let plan: SchedulePlan;
    try {
      plan = schedulePlanArtifactSchema.parse(planValue);
    } catch {
      throw new Error("Schedule plan artifact is invalid");
    }
    const checkedAt = this.now();
    if (Date.parse(approval.approvedAt) > checkedAt.getTime()) {
      throw new Error("Schedule approval has an invalid timestamp order");
    }
    if (plan.mode !== "local-plan" || plan.bloggerMutationPerformed !== false) {
      throw new Error("Schedule plan artifact is not a local-only plan");
    }
    const expectedPreview = prepareSchedulePreview(
      plan.scheduledAt,
      this.config.APP_TIMEZONE,
      checkedAt
    );
    if (
      plan.date !== expectedPreview.date ||
      plan.time !== expectedPreview.time ||
      plan.timezone !== expectedPreview.timezone
    ) {
      throw new Error("Approved schedule display time does not match scheduledAt");
    }

    const storedSchedule = this.repos.articles.findScheduleByJobId(input.jobId);
    if (!storedSchedule || storedSchedule.blogKey !== job.blogKey) {
      throw new Error("Approved schedule is missing its database article record");
    }
    if (new Date(storedSchedule.scheduledAt).toISOString() !== new Date(plan.scheduledAt).toISOString()) {
      throw new Error("Approved schedule time does not match its database article record");
    }
    const blog = this.repos.blogs.findConfig(job.blogKey);
    if (!blog) throw new Error(`Blog configuration not found: ${job.blogKey}`);
    const localDate = expectedPreview.date.replaceAll("/", "-");
    const systemCount = this.repos.articles.countSchedulePlansForLocalDate({
      localDate,
      timezone: this.config.APP_TIMEZONE
    });
    const blogCount = this.repos.articles.countSchedulePlansForLocalDate({
      localDate,
      timezone: this.config.APP_TIMEZONE,
      blogKey: job.blogKey
    });
    const systemLimit = this.config.SYSTEM_DAILY_POST_LIMIT;
    const blogLimit = Math.min(this.config.PER_BLOG_DAILY_POST_LIMIT, blog.dailyPostLimit);
    if (systemCount > systemLimit) {
      throw new Error(`System daily schedule limit exceeded: ${systemCount}/${systemLimit}`);
    }
    if (blogCount > blogLimit) {
      throw new Error(`Blog daily schedule limit exceeded: ${blogCount}/${blogLimit}`);
    }
    await assertNotStopped(this.config.DATA_DIR);
    const result: ScheduleReadinessResult = {
      jobId: input.jobId,
      checkedAt: checkedAt.toISOString(),
      planSha256: calculateSchedulePlanSha256(planText),
      localChecksPassed: true,
      executionEnabled: false,
      executionAuthorized: false,
      bloggerMutationPerformed: false,
      quota: { systemCount, systemLimit, blogCount, blogLimit }
    };
    await writeJsonArtifactAtomic(path.join(artifactDir, "schedule-readiness.json"), result);
    this.repos.jobs.addEvent(
      input.jobId,
      "SCHEDULE_READINESS_CHECKED",
      "Local schedule readiness checks passed without Blogger mutation",
      result
    );
    this.logger.info({ jobId: input.jobId, artifactDir }, "Local schedule readiness checks passed");
    return result;
  }
}