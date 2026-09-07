import {
  type DraftAuditResult,
  type ExistingDraftInspection,
  BloggerDryRunClient
} from "../browser/bloggerDryRun.js";
import { extractBloggerBlogId, extractBloggerPostId } from "../browser/bloggerEditorIdentity.js";
import { loadBloggerSelectors } from "../browser/bloggerSelectors.js";
import type { BlogConfig } from "../config/blogConfig.js";
import type { AppConfig } from "../config/env.js";
import type { ArticleInput } from "../domain/article.js";
import { evaluatePersistedDraft, type DraftPersistenceCheck } from "../domain/draftPersistence.js";

export type ExistingDraftAuditCheck = DraftPersistenceCheck;

export interface ExistingDraftCompleteAuditReport {
  schemaVersion: 1;
  auditType: "read-only-existing-draft-complete-audit";
  status: "PASS" | "FAIL" | "UNVERIFIED";
  auditedAt: string;
  target: {
    blogKey: string;
    expectedBlogId: string;
    expectedPostId: string;
    expectedEditUrl: string;
  };
  actual?: ExistingDraftInspection;
  duplicateTitleAudit?: DraftAuditResult;
  checks: Record<string, ExistingDraftAuditCheck>;
  reasons: string[];
  finalError?: string;
}

interface DraftInspectionClient {
  inspectExistingDraft(input: {
    adminUrl: string;
    postEditorUrl: string;
  }): Promise<ExistingDraftInspection>;
  findDrafts(input: { adminUrl: string; title: string }): Promise<DraftAuditResult>;
}

type DraftInspectionClientFactory = (blog: BlogConfig) => Promise<DraftInspectionClient>;

export class ExistingDraftCompleteAuditService {
  constructor(
    private readonly config: AppConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly clientFactory: DraftInspectionClientFactory = async (blog) =>
      new BloggerDryRunClient(this.config, await loadBloggerSelectors(blog.blogger.selectorsPath))
  ) {}

  async execute(input: {
    blog: BlogConfig;
    article: ArticleInput;
    postId: string;
    postEditorUrl: string;
  }): Promise<ExistingDraftCompleteAuditReport> {
    if (!/^\d{10,30}$/.test(input.postId)) {
      throw new Error("Existing draft audit requires a numeric Blogger post ID");
    }
    const expectedBlogId = extractBloggerBlogId(input.blog.adminUrl);
    const editorBlogId = extractBloggerBlogId(input.postEditorUrl);
    const urlPostId = extractBloggerPostId(input.postEditorUrl);
    if (!urlPostId) throw new Error("Existing draft audit requires an exact Blogger edit URL");
    if (!expectedBlogId || editorBlogId !== expectedBlogId) {
      throw new Error("Existing draft audit editor URL does not belong to configured blog");
    }
    if (urlPostId !== input.postId) {
      throw new Error("Existing draft audit editor URL post ID does not match expected post ID");
    }

    const client = await this.clientFactory(input.blog);
    const target = {
      blogKey: input.blog.blogKey,
      expectedBlogId,
      expectedPostId: input.postId,
      expectedEditUrl: input.postEditorUrl
    };
    let actual: ExistingDraftInspection;
    let duplicateTitleAudit: DraftAuditResult;
    try {
      [actual, duplicateTitleAudit] = await Promise.all([
        client.inspectExistingDraft({
          adminUrl: input.blog.adminUrl,
          postEditorUrl: input.postEditorUrl
        }),
        client.findDrafts({ adminUrl: input.blog.adminUrl, title: input.article.title })
      ]);
    } catch (error) {
      const finalError = error instanceof Error ? error.message : String(error);
      return {
        schemaVersion: 1,
        auditType: "read-only-existing-draft-complete-audit",
        status: "UNVERIFIED",
        auditedAt: this.now().toISOString(),
        target,
        checks: {},
        reasons: ["Blogger draft state could not be verified"],
        finalError
      };
    }

    const persistence = evaluatePersistedDraft({
      expectedBlogId,
      expectedPostId: input.postId,
      expectedEditUrl: input.postEditorUrl,
      article: input.article,
      actual
    });
    const expectedEditorUrl = input.postEditorUrl;
    const duplicateUrls = [...new Set(duplicateTitleAudit.editUrls)].sort();
    const checks: Record<string, ExistingDraftAuditCheck> = {
      ...persistence.checks,
      editorUrlPostId: {
        status: input.postId === urlPostId ? "PASS" : "FAIL",
        expected: input.postId,
        actual: urlPostId
      },
      duplicateTitle: {
        status:
          JSON.stringify([expectedEditorUrl]) === JSON.stringify(duplicateUrls) ? "PASS" : "FAIL",
        expected: [expectedEditorUrl],
        actual: duplicateUrls
      }
    };
    const reasons = Object.entries(checks)
      .filter(([, value]) => value.status === "FAIL")
      .map(([name]) => `${name}: expected and actual values differ`);

    return {
      schemaVersion: 1,
      auditType: "read-only-existing-draft-complete-audit",
      status: reasons.length === 0 ? "PASS" : "FAIL",
      auditedAt: this.now().toISOString(),
      target,
      actual,
      duplicateTitleAudit,
      checks,
      reasons
    };
  }
}
