import { blogConfigSchema, type BlogConfig } from "../config/blogConfig.js";
import { articleInputSchema, type ArticleInput } from "../domain/article.js";
import type { BlogRepository } from "../repositories/blogRepository.js";
import type { JobRepository } from "../repositories/jobRepository.js";
import type { SchedulePreparationEvidence } from "./scheduleEvidencePreparationService.js";

export class ScheduleCampaignItemRecoveryService {
  constructor(
    private readonly repos: {
      jobs: Pick<JobRepository, "find">;
      blogs: Pick<BlogRepository, "findConfig">;
    },
    private readonly stages: {
      approve: (input: { jobId: string; confirmation: string }) => Promise<unknown>;
      prepare: (input: {
        jobId: string;
        confirmation: string;
      }) => Promise<SchedulePreparationEvidence>;
    }
  ) {}

  async execute(input: {
    jobId: string;
    blog: BlogConfig;
    article: ArticleInput;
  }): Promise<SchedulePreparationEvidence> {
    const expectedBlog = blogConfigSchema.parse(input.blog);
    const expectedArticle = articleInputSchema.parse(input.article);
    const job = this.repos.jobs.find(input.jobId);
    if (!job || job.mode !== "schedule") {
      throw new Error(`Recoverable schedule job not found: ${input.jobId}`);
    }
    const storedBlog = this.repos.blogs.findConfig(job.blogKey);
    if (
      job.blogKey !== expectedBlog.blogKey ||
      !storedBlog ||
      JSON.stringify(storedBlog) !== JSON.stringify(expectedBlog)
    ) {
      throw new Error("Resumed campaign blog does not match the existing schedule job");
    }
    let storedArticle: ArticleInput;
    try {
      storedArticle = articleInputSchema.parse(JSON.parse(job.payloadJson));
    } catch {
      throw new Error("Existing schedule job article is invalid");
    }
    if (JSON.stringify(storedArticle) !== JSON.stringify(expectedArticle)) {
      throw new Error("Resumed campaign article does not match the existing schedule job");
    }

    if (job.status === "READY_FOR_POST") {
      await this.stages.approve({ jobId: input.jobId, confirmation: input.jobId });
    } else if (job.status !== "APPROVED_FOR_POST" && job.status !== "PREVIEW_CONFIRMED") {
      throw new Error(`Schedule campaign cannot resume job status: ${job.status}`);
    }
    return this.stages.prepare({ jobId: input.jobId, confirmation: input.jobId });
  }
}
