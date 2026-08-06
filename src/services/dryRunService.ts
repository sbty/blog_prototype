import type { Logger } from "pino";
import type { BlogConfig } from "../config/blogConfig.js";
import type { AppConfig } from "../config/env.js";
import { articleInputSchema, type ArticleInput } from "../domain/article.js";
import { BloggerDryRunClient } from "../browser/bloggerDryRun.js";
import { loadBloggerSelectors } from "../browser/bloggerSelectors.js";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped, StopRequestedError } from "../system/stop.js";
import { createArtifactDir, makeJobId, writeJobArtifacts } from "./artifacts.js";

export class DryRunService {
  constructor(
    private readonly config: AppConfig,
    private readonly repos: {
      blogs: BlogRepository;
      jobs: JobRepository;
      articles: ArticleRepository;
    },
    private readonly logger: Logger
  ) {}

  async execute(input: { blog: BlogConfig; article: ArticleInput }): Promise<{ jobId: string; artifactDir: string }> {
    input = { ...input, article: articleInputSchema.parse(input.article) };
    await assertNotStopped(this.config.DATA_DIR);
    this.repos.blogs.upsert(input.blog);

    const jobId = makeJobId("dryrun");
    const artifactDir = await createArtifactDir(this.config.DATA_DIR, jobId);
    const job = this.repos.jobs.create({
      id: jobId,
      blogKey: input.blog.blogKey,
      mode: "dry-run",
      payload: input.article,
      artifactDir
    });

    try {
      this.repos.jobs.updateStatus(jobId, "RUNNING", "Dry-run started");
      this.repos.articles.create({
        id: `article-${jobId}`,
        jobId,
        blogKey: input.blog.blogKey,
        ...input.article
      });

      const selectors = await loadBloggerSelectors(input.blog.blogger.selectorsPath);
      const dryRun = await new BloggerDryRunClient(this.config, selectors).run({
        adminUrl: input.blog.adminUrl,
        postEditorUrl: input.blog.blogger.postEditorUrl,
        article: input.article,
        artifactDir
      });
      this.repos.jobs.addEvent(jobId, "DRY_RUN_CAPTURED", "Blogger editor screenshot captured", dryRun);
      await writeJobArtifacts({ artifactDir, job, article: input.article, dryRun });
      this.repos.jobs.updateStatus(jobId, "DRY_RUN_DONE", "Dry-run completed", dryRun);
      this.logger.info({ jobId, artifactDir }, "Dry-run completed");
      return { jobId, artifactDir };
    } catch (error) {
      if (error instanceof StopRequestedError) {
        this.repos.jobs.stop(jobId, error);
      } else {
        this.repos.jobs.fail(jobId, error as Error);
      }
      throw error;
    }
  }
}
