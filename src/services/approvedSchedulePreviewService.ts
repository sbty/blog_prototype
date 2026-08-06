import { readArtifactFileInsideDirectory, writeTextArtifactAtomic } from "./artifacts.js";
import { validateBrowserPreviewEvidence } from "./browserPreviewValidation.js";
import { calculateArtifactSha256 } from "./scheduleApprovalIntegrity.js";
import path from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import { BloggerDryRunClient, type DryRunResult } from "../browser/bloggerDryRun.js";
import { loadBloggerSelectors } from "../browser/bloggerSelectors.js";
import type { BlogConfig } from "../config/blogConfig.js";
import type { AppConfig } from "../config/env.js";
import type { ArticleInput } from "../domain/article.js";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped } from "../system/stop.js";
import {
  ScheduleReadinessService,
  type ScheduleReadinessResult
} from "./scheduleReadinessService.js";
import { scheduleReadinessResultSchema } from "./scheduleArtifactValidation.js";

const scheduledArticleSchema = z.object({
  title: z.string().min(1),
  html: z.string(),
  labels: z.array(z.string()).default([]),
  searchDescription: z.string(),
  slug: z.string(),
  scheduledAt: z.string().min(1),
  imagePath: z.string().optional()
});

interface PreviewClient {
  run(input: {
    adminUrl: string;
    postEditorUrl?: string;
    article: ArticleInput;
    artifactDir: string;
  }): Promise<DryRunResult>;
}

interface ReadinessChecker {
  execute(input: { jobId: string }): Promise<ScheduleReadinessResult>;
}

export interface ApprovedSchedulePreviewArtifact {
  jobId: string;
  readiness: ScheduleReadinessResult;
  dryRun: DryRunResult;
  bloggerMutationPerformed: false;
  executionAuthorized: false;
  evidence: {
    previewedAt: string;
    planSha256: string;
    approvalSha256: string;
    screenshotSha256: string;
  };
}

export interface ApprovedSchedulePreviewResult extends ApprovedSchedulePreviewArtifact {
  previewArtifactSha256: string;
}
export class ApprovedSchedulePreviewService {
  constructor(
    private readonly config: AppConfig,
    private readonly repos: {
      jobs: JobRepository;
      articles: ArticleRepository;
      blogs: BlogRepository;
    },
    private readonly logger: Logger,
    private readonly clientFactory: (blog: BlogConfig) => Promise<PreviewClient> = async (blog) =>
      new BloggerDryRunClient(config, await loadBloggerSelectors(blog.blogger.selectorsPath)),
    private readonly readiness: ReadinessChecker = new ScheduleReadinessService(
      config,
      repos,
      logger
    ),
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: { jobId: string }): Promise<ApprovedSchedulePreviewResult> {
    if (!this.config.ENABLE_DRY_RUN) {
      throw new Error("Approved schedule preview requires ENABLE_DRY_RUN=true");
    }
    if (this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Approved schedule preview requires ENABLE_DRAFT_SAVE=false and ENABLE_SCHEDULED_POST=false"
      );
    }
    const job = this.repos.jobs.find(input.jobId);
    if (!job) throw new Error(`Schedule job not found: ${input.jobId}`);
    if (job.mode !== "schedule" || job.status !== "APPROVED_FOR_POST") {
      throw new Error(
        `Schedule job must be APPROVED_FOR_POST for browser preview: ${job.mode}/${job.status}`
      );
    }
    const blog = this.repos.blogs.findConfig(job.blogKey);
    if (!blog) throw new Error(`Blog configuration not found: ${job.blogKey}`);
    const article = scheduledArticleSchema.parse(JSON.parse(job.payloadJson));
    let readiness: ScheduleReadinessResult;
    try {
      readiness = scheduleReadinessResultSchema.parse(
        await this.readiness.execute({ jobId: input.jobId })
      );
    } catch {
      throw new Error("Schedule readiness result is invalid");
    }
    if (readiness.jobId !== input.jobId) {
      throw new Error("Schedule readiness result belongs to another job");
    }
    const previewedAt = this.now();
    if (Date.parse(readiness.checkedAt) > previewedAt.getTime()) {
      throw new Error("Schedule readiness result has an invalid timestamp order");
    }
    const dryRun = await (
      await this.clientFactory(blog)
    ).run({
      adminUrl: blog.adminUrl,
      postEditorUrl: blog.blogger.postEditorUrl,
      article,
      artifactDir: job.artifactDir
    });
    await assertNotStopped(this.config.DATA_DIR);
    const screenshotBytes = await validateBrowserPreviewEvidence(dryRun, job.artifactDir);
    if (
      !dryRun.schedulePreview ||
      dryRun.schedulePreview.scheduledAt !== new Date(article.scheduledAt).toISOString() ||
      dryRun.schedulePreview.timezone !== this.config.APP_TIMEZONE
    ) {
      throw new Error("Browser schedule preview does not match the scheduled article");
    }
    await assertNotStopped(this.config.DATA_DIR);
    const approvalBytes = await readArtifactFileInsideDirectory(
      job.artifactDir,
      "schedule-approval.json"
    );
    const artifact: ApprovedSchedulePreviewArtifact = {
      jobId: input.jobId,
      readiness,
      dryRun,
      bloggerMutationPerformed: false,
      executionAuthorized: false,
      evidence: {
        previewedAt: previewedAt.toISOString(),
        planSha256: readiness.planSha256,
        approvalSha256: calculateArtifactSha256(approvalBytes),
        screenshotSha256: calculateArtifactSha256(screenshotBytes)
      }
    };
    const artifactJson = JSON.stringify(artifact, null, 2);
    const result: ApprovedSchedulePreviewResult = {
      ...artifact,
      previewArtifactSha256: calculateArtifactSha256(artifactJson)
    };
    await writeTextArtifactAtomic(
      path.join(job.artifactDir, "schedule-browser-preview.json"),
      artifactJson
    );
    this.repos.jobs.addEvent(
      input.jobId,
      "SCHEDULE_BROWSER_PREVIEWED",
      "Approved schedule previewed with mutation network requests blocked",
      result
    );
    this.logger.info({ jobId: input.jobId, artifactDir: job.artifactDir }, "Schedule previewed");
    return result;
  }
}
