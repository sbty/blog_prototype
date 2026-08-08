import type { Logger } from "pino";
import {
  BloggerDryRunClient,
  type DraftAuditResult,
  type DraftSaveResult
} from "../browser/bloggerDryRun.js";
import { loadBloggerSelectors } from "../browser/bloggerSelectors.js";
import type { BlogConfig } from "../config/blogConfig.js";
import type { AppConfig } from "../config/env.js";
import { articleInputSchema, type ArticleInput } from "../domain/article.js";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped, StopRequestedError } from "../system/stop.js";
import { createArtifactDir, makeJobId, writeJobArtifacts } from "./artifacts.js";
import { assertNoExistingDraft } from "./draftAuditValidation.js";
import { validateDraftSaveEvidence, validateDraftSaveResult } from "./draftSaveValidation.js";

interface DraftClient {
  findDrafts(input: { adminUrl: string; title: string }): Promise<DraftAuditResult>;
  saveDraft(input: {
    adminUrl: string;
    postEditorUrl?: string;
    article: ArticleInput;
    artifactDir: string;
    assertCanMutate: () => Promise<void>;
  }): Promise<DraftSaveResult>;
}

type DraftClientFactory = (blog: BlogConfig) => Promise<DraftClient>;

export class DraftSaveService {
  constructor(
    private readonly config: AppConfig,
    private readonly repos: {
      blogs: BlogRepository;
      jobs: JobRepository;
      articles: ArticleRepository;
    },
    private readonly logger: Logger,
    private readonly clientFactory: DraftClientFactory = async (blog) =>
      new BloggerDryRunClient(config, await loadBloggerSelectors(blog.blogger.selectorsPath))
  ) {}

  async execute(input: {
    blog: BlogConfig;
    article: ArticleInput;
  }): Promise<{ jobId: string; artifactDir: string }> {
    input = { ...input, article: articleInputSchema.parse(input.article) };
    if (!this.config.ENABLE_DRAFT_SAVE) {
      throw new Error("Draft save is disabled by ENABLE_DRAFT_SAVE=false");
    }
    if (this.config.ENABLE_SCHEDULED_POST) {
      throw new Error("Draft save requires ENABLE_SCHEDULED_POST=false");
    }
    await assertNotStopped(this.config.DATA_DIR);
    this.repos.blogs.upsert(input.blog);

    const jobId = makeJobId("draft");
    const artifactDir = await createArtifactDir(this.config.DATA_DIR, jobId);
    const job = this.repos.jobs.create({
      id: jobId,
      blogKey: input.blog.blogKey,
      mode: "draft",
      payload: input.article,
      artifactDir
    });

    try {
      this.repos.jobs.updateStatus(jobId, "RUNNING", "Draft save started");
      this.repos.articles.create({
        id: `article-${jobId}`,
        jobId,
        blogKey: input.blog.blogKey,
        ...input.article
      });
      const client = await this.clientFactory(input.blog);
      const preSaveAudit = assertNoExistingDraft(
        await client.findDrafts({
          adminUrl: input.blog.adminUrl,
          title: input.article.title
        })
      );
      this.repos.jobs.addEvent(
        jobId,
        "DRAFT_AUDITED",
        "Blogger drafts checked before save",
        preSaveAudit
      );
      const draft = validateDraftSaveResult(
        await client.saveDraft({
          adminUrl: input.blog.adminUrl,
          postEditorUrl: input.blog.blogger.postEditorUrl,
          article: input.article,
          artifactDir,
          assertCanMutate: () => assertNotStopped(this.config.DATA_DIR)
        }),
        {
          adminUrl: input.blog.adminUrl,
          postEditorUrl: input.blog.blogger.postEditorUrl
        }
      );
      await validateDraftSaveEvidence(draft, artifactDir);
      this.repos.jobs.addEvent(
        jobId,
        "DRAFT_CAPTURED",
        "Blogger draft save evidence captured",
        draft
      );
      await writeJobArtifacts({
        artifactDir,
        job,
        article: input.article,
        draft: { ...draft, preSaveAudit }
      });
      this.repos.jobs.updateStatus(jobId, "DRAFT_SAVED", "Draft saved", draft);
      this.logger.info({ jobId, artifactDir }, "Draft saved");
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
