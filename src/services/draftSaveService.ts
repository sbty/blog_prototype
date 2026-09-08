import type { Logger } from "pino";
import {
  BloggerDryRunClient,
  type DraftAuditResult,
  type DraftSaveResult,
  type ExistingDraftImageUpdateResult
} from "../browser/bloggerDryRun.js";
import { extractBloggerPostId } from "../browser/bloggerEditorIdentity.js";
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
import { assertDraftSaveAuthorized } from "./draftSaveAuthorization.js";
import { validateDraftSaveEvidence, validateDraftSaveResult } from "./draftSaveValidation.js";
import { ExistingDraftCompleteAuditService } from "./existingDraftCompleteAuditService.js";

interface DraftClient {
  findDrafts(input: { adminUrl: string; title: string }): Promise<DraftAuditResult>;
  saveDraft(input: {
    adminUrl: string;
    postEditorUrl?: string;
    article: ArticleInput;
    artifactDir: string;
    assertCanMutate: () => Promise<void>;
  }): Promise<DraftSaveResult>;
  updateExistingDraftImage?(input: {
    adminUrl: string;
    postEditorUrl: string;
    article: ArticleInput;
    artifactDir: string;
    assertCanMutate: () => Promise<void>;
  }): Promise<ExistingDraftImageUpdateResult>;
}

type DraftClientFactory = (blog: BlogConfig) => Promise<DraftClient>;
type DraftPersistenceAuditor = Pick<ExistingDraftCompleteAuditService, "execute">;

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
      new BloggerDryRunClient(config, await loadBloggerSelectors(blog.blogger.selectorsPath)),
    private readonly persistenceAuditor: DraftPersistenceAuditor = new ExistingDraftCompleteAuditService(
      config
    )
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
    if (input.blog.blogger.postEditorUrl && !this.config.ENABLE_EXISTING_DRAFT_UPDATE) {
      throw new Error("Existing draft update requires ENABLE_EXISTING_DRAFT_UPDATE=true");
    }
    assertDraftSaveAuthorized(this.config, [input.blog]);
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
      const preSaveAudit = input.blog.blogger.postEditorUrl
        ? {
            title: input.article.title,
            editUrls: [input.blog.blogger.postEditorUrl],
            count: 1,
            rowTexts: ["Direct existing-draft target"]
          }
        : assertNoExistingDraft(
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
      const persistenceAudit = await this.auditPersistedDraft({
        blog: input.blog,
        article: input.article,
        currentUrl: draft.currentUrl
      });
      this.repos.jobs.addEvent(jobId, "DRAFT_CAPTURED", "Blogger draft save evidence captured", {
        ...draft,
        persistenceAudit
      });
      await writeJobArtifacts({
        artifactDir,
        job,
        article: input.article,
        draft: { ...draft, preSaveAudit, persistenceAudit }
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

  async executeImageOnly(input: {
    blog: BlogConfig;
    article: ArticleInput;
  }): Promise<{ jobId: string; artifactDir: string }> {
    input = { ...input, article: articleInputSchema.parse(input.article) };
    if (!input.article.imagePath) throw new Error("Existing draft image update requires imagePath");
    if (!this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error("Existing draft image update requires draft-save mode only");
    }
    if (!input.blog.blogger.postEditorUrl || !this.config.ENABLE_EXISTING_DRAFT_UPDATE) {
      throw new Error("Existing draft image update requires an authorized exact post editor URL");
    }
    assertDraftSaveAuthorized(this.config, [input.blog]);
    await assertNotStopped(this.config.DATA_DIR);
    this.repos.blogs.upsert(input.blog);

    const jobId = makeJobId("draft-image");
    const artifactDir = await createArtifactDir(this.config.DATA_DIR, jobId);
    const job = this.repos.jobs.create({
      id: jobId,
      blogKey: input.blog.blogKey,
      mode: "draft",
      payload: input.article,
      artifactDir
    });

    try {
      this.repos.jobs.updateStatus(jobId, "RUNNING", "Existing draft image update started");
      const client = await this.clientFactory(input.blog);
      if (!client.updateExistingDraftImage) {
        throw new Error("Draft client does not support existing draft image-only updates");
      }
      const preSaveAudit = {
        title: input.article.title,
        editUrls: [input.blog.blogger.postEditorUrl],
        count: 1,
        rowTexts: ["Direct existing-draft image-only target"]
      };
      this.repos.jobs.addEvent(
        jobId,
        "DRAFT_AUDITED",
        "Existing Blogger draft was selected by exact editor URL before image-only update",
        preSaveAudit
      );
      const draft = validateDraftSaveResult(
        await client.updateExistingDraftImage({
          adminUrl: input.blog.adminUrl,
          postEditorUrl: input.blog.blogger.postEditorUrl,
          article: input.article,
          artifactDir,
          assertCanMutate: () => assertNotStopped(this.config.DATA_DIR)
        }),
        { adminUrl: input.blog.adminUrl, postEditorUrl: input.blog.blogger.postEditorUrl }
      );
      await validateDraftSaveEvidence(draft, artifactDir);
      const persistenceAudit = await this.auditPersistedDraft({
        blog: input.blog,
        article: input.article,
        currentUrl: draft.currentUrl
      });
      this.repos.jobs.addEvent(
        jobId,
        "DRAFT_CAPTURED",
        "Existing Blogger draft image-only update evidence captured",
        { ...draft, persistenceAudit }
      );
      await writeJobArtifacts({
        artifactDir,
        job,
        article: input.article,
        draft: { ...draft, preSaveAudit, persistenceAudit, updateMode: "image-only" }
      });
      this.repos.jobs.updateStatus(jobId, "DRAFT_SAVED", "Existing draft image updated", draft);
      this.logger.info({ jobId, artifactDir }, "Existing draft image updated");
      return { jobId, artifactDir };
    } catch (error) {
      if (error instanceof StopRequestedError) this.repos.jobs.stop(jobId, error);
      else this.repos.jobs.fail(jobId, error as Error);
      throw error;
    }
  }

  private async auditPersistedDraft(input: {
    blog: BlogConfig;
    article: ArticleInput;
    currentUrl: string;
  }) {
    const postId = extractBloggerPostId(input.currentUrl);
    if (!postId) throw new Error("Draft save persistence audit requires a Blogger post ID");
    const report = await this.persistenceAuditor.execute({
      blog: input.blog,
      article: input.article,
      postId,
      postEditorUrl: input.currentUrl
    });
    if (report.status !== "PASS") {
      throw new Error(`Draft save persistence audit failed: ${report.reasons.join("; ")}`);
    }
    return report;
  }
}
