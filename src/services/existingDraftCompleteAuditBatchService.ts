import { extractBloggerBlogId, extractBloggerPostId } from "../browser/bloggerEditorIdentity.js";
import type { BlogConfig } from "../config/blogConfig.js";
import type { AppConfig } from "../config/env.js";
import type { ArticleInput } from "../domain/article.js";
import type { ExistingDraftCompleteAuditReport } from "./existingDraftCompleteAuditService.js";
import { ExistingDraftCompleteAuditService } from "./existingDraftCompleteAuditService.js";

export interface ExistingDraftCompleteAuditBatchItemInput {
  blogPath: string;
  articlePath: string;
  postId: string;
  postEditorUrl: string;
  slug: string;
  blog: BlogConfig;
  article: ArticleInput;
}

export interface ExistingDraftCompleteAuditBatchItemResult {
  index: number;
  slug: string;
  blogKey: string;
  postId: string;
  postEditorUrl: string;
  status: "PASS" | "FAIL" | "UNVERIFIED";
  auditedAt: string;
  reasons: string[];
  report?: ExistingDraftCompleteAuditReport;
}

export interface ExistingDraftCompleteAuditBatchReport {
  schemaVersion: 1;
  auditType: "read-only-existing-draft-complete-audit-batch";
  status: "PASS" | "FAIL" | "UNVERIFIED";
  startedAt: string;
  completedAt: string;
  counts: { total: number; pass: number; fail: number; unverified: number };
  items: ExistingDraftCompleteAuditBatchItemResult[];
}

export interface ExistingDraftCompleteAuditBatchSummaryItem
  extends Omit<ExistingDraftCompleteAuditBatchItemResult, "postEditorUrl" | "report"> {
  detailFile: string;
}

export interface ExistingDraftCompleteAuditBatchSummary
  extends Omit<ExistingDraftCompleteAuditBatchReport, "items"> {
  items: ExistingDraftCompleteAuditBatchSummaryItem[];
}

export function summarizeExistingDraftCompleteAuditBatch(
  report: ExistingDraftCompleteAuditBatchReport,
  detailFile: (item: Pick<ExistingDraftCompleteAuditBatchItemResult, "index" | "slug">) => string
): ExistingDraftCompleteAuditBatchSummary {
  return {
    schemaVersion: report.schemaVersion,
    auditType: report.auditType,
    status: report.status,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    counts: report.counts,
    items: report.items.map((item) => ({
      index: item.index,
      slug: item.slug,
      blogKey: item.blogKey,
      postId: item.postId,
      status: item.status,
      auditedAt: item.auditedAt,
      reasons: item.reasons,
      detailFile: detailFile(item)
    }))
  };
}

type AuditFactory = () => Pick<ExistingDraftCompleteAuditService, "execute">;

export class ExistingDraftCompleteAuditBatchService {
  constructor(
    private readonly config: AppConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly auditFactory: AuditFactory = () =>
      new ExistingDraftCompleteAuditService(this.config, this.now)
  ) {}

  async execute(input: {
    items: ExistingDraftCompleteAuditBatchItemInput[];
  }): Promise<ExistingDraftCompleteAuditBatchReport> {
    this.validatePreflight(input.items);
    const startedAt = this.now().toISOString();
    const items: ExistingDraftCompleteAuditBatchItemResult[] = [];
    for (const [index, item] of input.items.entries()) {
      try {
        const report = await this.auditFactory().execute({
          blog: item.blog,
          article: item.article,
          postId: item.postId,
          postEditorUrl: item.postEditorUrl
        });
        items.push({
          index,
          slug: item.slug,
          blogKey: item.blog.blogKey,
          postId: item.postId,
          postEditorUrl: item.postEditorUrl,
          status: report.status,
          auditedAt: report.auditedAt,
          reasons: report.reasons,
          report
        });
      } catch (error) {
        items.push({
          index,
          slug: item.slug,
          blogKey: item.blog.blogKey,
          postId: item.postId,
          postEditorUrl: item.postEditorUrl,
          status: "UNVERIFIED",
          auditedAt: this.now().toISOString(),
          reasons: [error instanceof Error ? error.message : String(error)]
        });
      }
    }
    const pass = items.filter((item) => item.status === "PASS").length;
    const fail = items.filter((item) => item.status === "FAIL").length;
    const unverified = items.filter((item) => item.status === "UNVERIFIED").length;
    return {
      schemaVersion: 1,
      auditType: "read-only-existing-draft-complete-audit-batch",
      status: unverified > 0 ? "UNVERIFIED" : fail > 0 ? "FAIL" : "PASS",
      startedAt,
      completedAt: this.now().toISOString(),
      counts: { total: items.length, pass, fail, unverified },
      items
    };
  }

  validatePreflight(items: ExistingDraftCompleteAuditBatchItemInput[]): void {
    const postIds = new Set<string>();
    const editorUrls = new Set<string>();
    for (const item of items) {
      if (postIds.has(item.postId)) throw new Error(`Duplicate postId: ${item.postId}`);
      postIds.add(item.postId);
      if (editorUrls.has(item.postEditorUrl)) {
        throw new Error(`Duplicate postEditorUrl: ${item.postEditorUrl}`);
      }
      editorUrls.add(item.postEditorUrl);
      if (item.slug !== item.article.slug) {
        throw new Error(`Manifest slug does not match article slug for ${item.slug}`);
      }
      const configuredBlogId = extractBloggerBlogId(item.blog.adminUrl);
      const editorBlogId = extractBloggerBlogId(item.postEditorUrl);
      if (!configuredBlogId || editorBlogId !== configuredBlogId) {
        throw new Error(`Editor URL does not belong to configured blog for ${item.slug}`);
      }
      if (extractBloggerPostId(item.postEditorUrl) !== item.postId) {
        throw new Error(`Editor URL postId does not match manifest postId for ${item.slug}`);
      }
    }
  }
}
