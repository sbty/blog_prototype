import type { Logger } from "pino";
import { prepareSchedulePreview, type SchedulePreviewValue } from "../browser/bloggerSchedulePreview.js";
import type { BlogConfig } from "../config/blogConfig.js";
import type { AppConfig } from "../config/env.js";
import { articleInputSchema, type ArticleInput } from "../domain/article.js";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped, StopRequestedError } from "../system/stop.js";
import { createArtifactDir, makeJobId, writeJobArtifacts } from "./artifacts.js";

export interface SchedulePlan extends SchedulePreviewValue {
  mode: "local-plan";
  bloggerMutationPerformed: false;
  quota: {
    systemCount: number;
    systemLimit: number;
    blogCount: number;
    blogLimit: number;
  };
}

export class SchedulePlanService {
  constructor(
    private readonly config: AppConfig,
    private readonly repos: {
      blogs: BlogRepository;
      jobs: JobRepository;
      articles: ArticleRepository;
    },
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: {
    blog: BlogConfig;
    article: ArticleInput;
  }): Promise<{ jobId: string; artifactDir: string; plan: SchedulePlan }> {
    input = { ...input, article: articleInputSchema.parse(input.article) };
    if (this.config.ENABLE_SCHEDULED_POST) {
      throw new Error("Local schedule planning requires ENABLE_SCHEDULED_POST=false");
    }
    if (!input.article.scheduledAt) {
      throw new Error("Schedule planning requires article.scheduledAt");
    }
    await assertNotStopped(this.config.DATA_DIR);

    const preview = prepareSchedulePreview(
      input.article.scheduledAt,
      this.config.APP_TIMEZONE,
      this.now()
    );
    const localDate = preview.date.replaceAll("/", "-");
    const systemCount = this.repos.articles.countSchedulePlansForLocalDate({
      localDate,
      timezone: this.config.APP_TIMEZONE
    });
    const blogCount = this.repos.articles.countSchedulePlansForLocalDate({
      localDate,
      timezone: this.config.APP_TIMEZONE,
      blogKey: input.blog.blogKey
    });
    const systemLimit = this.config.SYSTEM_DAILY_POST_LIMIT;
    const blogLimit = Math.min(
      this.config.PER_BLOG_DAILY_POST_LIMIT,
      input.blog.dailyPostLimit
    );
    if (systemCount >= systemLimit) {
      throw new Error(`System daily schedule limit reached for ${localDate}: ${systemCount}/${systemLimit}`);
    }
    if (blogCount >= blogLimit) {
      throw new Error(
        `Blog daily schedule limit reached for ${input.blog.blogKey} on ${localDate}: ${blogCount}/${blogLimit}`
      );
    }
    const plan: SchedulePlan = {
      ...preview,
      mode: "local-plan",
      bloggerMutationPerformed: false,
      quota: { systemCount, systemLimit, blogCount, blogLimit }
    };

    this.repos.blogs.upsert(input.blog);
    const jobId = makeJobId("schedule-plan");
    const artifactDir = await createArtifactDir(this.config.DATA_DIR, jobId);
    const job = this.repos.jobs.create({
      id: jobId,
      blogKey: input.blog.blogKey,
      mode: "schedule",
      payload: input.article,
      artifactDir
    });

    try {
      this.repos.jobs.updateStatus(jobId, "RUNNING", "Local schedule planning started");
      this.repos.articles.create({
        id: `article-${jobId}`,
        jobId,
        blogKey: input.blog.blogKey,
        ...input.article
      });
      this.repos.jobs.addEvent(
        jobId,
        "SCHEDULE_PLANNED",
        "Local schedule plan created without Blogger mutation",
        plan
      );
      await writeJobArtifacts({ artifactDir, job, article: input.article, schedulePlan: plan });
      const finalSystemCount = this.repos.articles.countSchedulePlansForLocalDate({
        localDate,
        timezone: this.config.APP_TIMEZONE
      });
      const finalBlogCount = this.repos.articles.countSchedulePlansForLocalDate({
        localDate,
        timezone: this.config.APP_TIMEZONE,
        blogKey: input.blog.blogKey
      });
      if (finalSystemCount > systemLimit) {
        throw new Error(
          `System daily schedule limit exceeded concurrently for ${localDate}: ${finalSystemCount}/${systemLimit}`
        );
      }
      if (finalBlogCount > blogLimit) {
        throw new Error(
          `Blog daily schedule limit exceeded concurrently for ${input.blog.blogKey} on ${localDate}: ${finalBlogCount}/${blogLimit}`
        );
      }
      await assertNotStopped(this.config.DATA_DIR);
      this.repos.jobs.updateStatus(jobId, "READY_FOR_POST", "Schedule plan ready", plan);
      this.logger.info({ jobId, artifactDir, plan }, "Local schedule plan ready");
      return { jobId, artifactDir, plan };
    } catch (error) {
      if (error instanceof StopRequestedError) this.repos.jobs.stop(jobId, error);
      else this.repos.jobs.fail(jobId, error as Error);
      throw error;
    }
  }
}