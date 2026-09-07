import type { BloggerPostListEntry, ExistingDraftInspection } from "../browser/bloggerDryRun.js";
import { extractBloggerBlogId, extractBloggerPostId } from "../browser/bloggerEditorIdentity.js";
import type { BlogConfig } from "../config/blogConfig.js";
import type { ArticleInput } from "../domain/article.js";
import type { ExistingDraftAuditBatchManifest } from "../domain/existingDraftAuditBatch.js";

export interface ExistingDraftAuditSelectionItemInput {
  batch: string;
  blogPath: string;
  articlePath: string;
  postId: string;
  postEditorUrl: string;
  slug: string;
  blog: BlogConfig;
  article: ArticleInput;
}

export interface ExistingDraftAuditSelectionDecision {
  batch: string;
  blogKey: string;
  slug: string;
  postId: string;
  postEditorUrl: string;
  title: string;
  listState: BloggerPostListEntry["postState"] | "NOT_FOUND" | "UNVERIFIED";
  editorState?: ExistingDraftInspection["postState"] | "UNVERIFIED";
  editorPublishedAt?: string;
  decision: "SELECTED" | "EXCLUDED" | "UNVERIFIED";
  reason: string;
  listAttempts: number;
  editorAttempts?: number;
  finalError?: string;
}

export interface ExistingDraftAuditSelectionReport {
  schemaVersion: 1;
  auditType: "read-only-existing-draft-audit-selection";
  status: "TARGETS_SELECTED" | "NO_ELIGIBLE_TARGETS" | "SELECTION_INCOMPLETE";
  executedAt: string;
  counts: { localCanonical: number; selected: number; excluded: number; unverified: number };
  decisions: ExistingDraftAuditSelectionDecision[];
  auditManifest: ExistingDraftAuditBatchManifest | null;
}

export interface ExistingDraftAuditSelectionBrowser {
  listPosts(input: {
    adminUrl: string;
  }): Promise<{ blogId: string; posts: BloggerPostListEntry[] }>;
  inspectExistingDraft(input: {
    adminUrl: string;
    postEditorUrl: string;
  }): Promise<ExistingDraftInspection>;
}

export interface ExistingDraftAuditSelectionRetryOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

interface ReadAttempt<T> {
  ok: boolean;
  attempts: number;
  value?: T;
  error?: string;
}

function isRetryableReadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /net::ERR_|timed?_?out|Target page, context or browser has been closed|Blogger session is not ready/i.test(
    message
  );
}

async function retryReadOnly<T>(
  operation: () => Promise<T>,
  options: Required<ExistingDraftAuditSelectionRetryOptions>
): Promise<ReadAttempt<T>> {
  let lastError: unknown;
  let attempts = 0;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      return { ok: true, attempts: attempt, value: await operation() };
    } catch (error) {
      lastError = error;
      if (attempt === options.maxAttempts || !isRetryableReadError(error)) break;
      if (options.retryDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, options.retryDelayMs));
      }
    }
  }
  return {
    ok: false,
    attempts,
    error: lastError instanceof Error ? lastError.message : String(lastError)
  };
}

function isFutureJstDate(value: string | undefined, now: Date): boolean {
  const match = value?.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!match) return false;
  const [, year, month, day, hour, minute] = match;
  return Date.UTC(+year, +month - 1, +day, +hour - 9, +minute) > now.getTime();
}

export class ExistingDraftAuditSelectionService {
  constructor(
    private readonly browser: ExistingDraftAuditSelectionBrowser,
    private readonly now: () => Date = () => new Date(),
    private readonly retryOptions: ExistingDraftAuditSelectionRetryOptions = {}
  ) {}

  async execute(input: {
    items: ExistingDraftAuditSelectionItemInput[];
  }): Promise<ExistingDraftAuditSelectionReport> {
    this.validatePreflight(input.items);
    const options: Required<ExistingDraftAuditSelectionRetryOptions> = {
      maxAttempts: this.retryOptions.maxAttempts ?? 3,
      retryDelayMs: this.retryOptions.retryDelayMs ?? 250
    };
    const lists = new Map<string, ReadAttempt<{ blogId: string; posts: BloggerPostListEntry[] }>>();
    for (const adminUrl of new Set(input.items.map((item) => item.blog.adminUrl))) {
      lists.set(adminUrl, await retryReadOnly(() => this.browser.listPosts({ adminUrl }), options));
    }

    const decisions: ExistingDraftAuditSelectionDecision[] = [];
    for (const item of input.items) {
      const listAttempt = lists.get(item.blog.adminUrl)!;
      if (!listAttempt.ok || !listAttempt.value) {
        decisions.push({
          batch: item.batch,
          blogKey: item.blog.blogKey,
          slug: item.slug,
          postId: item.postId,
          postEditorUrl: item.postEditorUrl,
          title: item.article.title,
          listState: "UNVERIFIED",
          decision: "UNVERIFIED",
          reason: "Blogger post list could not be verified after bounded retries",
          listAttempts: listAttempt.attempts,
          finalError: listAttempt.error
        });
        continue;
      }
      const list = listAttempt.value;
      const matchingPost = list.posts.find((post) => post.postId === item.postId);
      const sameTitleCount = list.posts.filter((post) => post.title === item.article.title).length;
      const base = {
        batch: item.batch,
        blogKey: item.blog.blogKey,
        slug: item.slug,
        postId: item.postId,
        postEditorUrl: item.postEditorUrl,
        title: item.article.title
      };
      if (!matchingPost) {
        decisions.push({
          ...base,
          listState: "NOT_FOUND",
          decision: "EXCLUDED",
          reason: "Post ID was not found in the Blogger post list",
          listAttempts: listAttempt.attempts
        });
        continue;
      }
      if (matchingPost.editUrl !== item.postEditorUrl) {
        decisions.push({
          ...base,
          listState: matchingPost.postState,
          decision: "EXCLUDED",
          reason: "Blogger post-list editor URL does not match the local canonical URL",
          listAttempts: listAttempt.attempts
        });
        continue;
      }
      if (matchingPost.title !== item.article.title) {
        decisions.push({
          ...base,
          listState: matchingPost.postState,
          decision: "EXCLUDED",
          reason: "Blogger post-list title does not match the local canonical title",
          listAttempts: listAttempt.attempts
        });
        continue;
      }
      if (sameTitleCount > 1) {
        decisions.push({
          ...base,
          listState: matchingPost.postState,
          decision: "EXCLUDED",
          reason: "Same-title duplicate exists in the Blogger post list",
          listAttempts: listAttempt.attempts
        });
        continue;
      }
      if (matchingPost.postState === "PUBLISHED") {
        decisions.push({
          ...base,
          listState: matchingPost.postState,
          decision: "EXCLUDED",
          reason: "Post list identifies the post as published",
          listAttempts: listAttempt.attempts
        });
        continue;
      }
      if (matchingPost.postState === "SCHEDULED") {
        decisions.push({
          ...base,
          listState: matchingPost.postState,
          decision: "EXCLUDED",
          reason: "Post list identifies the post as scheduled",
          listAttempts: listAttempt.attempts
        });
        continue;
      }
      if (matchingPost.postState !== "DRAFT") {
        decisions.push({
          ...base,
          listState: matchingPost.postState,
          decision: "EXCLUDED",
          reason: "Post list did not identify the post as a draft candidate",
          listAttempts: listAttempt.attempts
        });
        continue;
      }

      const editorAttempt = await retryReadOnly(
        () =>
          this.browser.inspectExistingDraft({
            adminUrl: item.blog.adminUrl,
            postEditorUrl: item.postEditorUrl
          }),
        options
      );
      if (!editorAttempt.ok || !editorAttempt.value) {
        decisions.push({
          ...base,
          listState: matchingPost.postState,
          editorState: "UNVERIFIED",
          decision: "UNVERIFIED",
          reason: "Blogger post editor could not be verified after bounded retries",
          listAttempts: listAttempt.attempts,
          editorAttempts: editorAttempt.attempts,
          finalError: editorAttempt.error
        });
        continue;
      }
      const editor = editorAttempt.value;
      const editorPublishedAt = editor.publishedAt;
      const scheduled =
        editor.postState === "SCHEDULED" || isFutureJstDate(editorPublishedAt, this.now());
      if (
        editor.blogId !== list.blogId ||
        editor.postId !== item.postId ||
        editor.editUrl !== item.postEditorUrl
      ) {
        decisions.push({
          ...base,
          listState: matchingPost.postState,
          editorState: editor.postState,
          editorPublishedAt,
          decision: "EXCLUDED",
          reason: "Editor identity does not match the local canonical post",
          listAttempts: listAttempt.attempts,
          editorAttempts: editorAttempt.attempts
        });
        continue;
      }
      if (editor.postState === "PUBLISHED") {
        decisions.push({
          ...base,
          listState: matchingPost.postState,
          editorState: editor.postState,
          editorPublishedAt,
          decision: "EXCLUDED",
          reason: "Editor identifies the post as published",
          listAttempts: listAttempt.attempts,
          editorAttempts: editorAttempt.attempts
        });
        continue;
      }
      if (scheduled) {
        decisions.push({
          ...base,
          listState: matchingPost.postState,
          editorState: editor.postState,
          editorPublishedAt,
          decision: "EXCLUDED",
          reason: "Editor has a future publish date or identifies the post as scheduled",
          listAttempts: listAttempt.attempts,
          editorAttempts: editorAttempt.attempts
        });
        continue;
      }
      if (editor.postState !== "DRAFT") {
        decisions.push({
          ...base,
          listState: matchingPost.postState,
          editorState: editor.postState,
          editorPublishedAt,
          decision: "EXCLUDED",
          reason: "Editor did not identify an editable unscheduled draft",
          listAttempts: listAttempt.attempts,
          editorAttempts: editorAttempt.attempts
        });
        continue;
      }
      decisions.push({
        ...base,
        listState: matchingPost.postState,
        editorState: editor.postState,
        editorPublishedAt,
        decision: "SELECTED",
        reason: "Local canonical post is an unscheduled, unpublished, unique Blogger draft",
        listAttempts: listAttempt.attempts,
        editorAttempts: editorAttempt.attempts
      });
    }

    const selected = decisions.filter((decision) => decision.decision === "SELECTED");
    const unverified = decisions.filter((decision) => decision.decision === "UNVERIFIED");
    return {
      schemaVersion: 1,
      auditType: "read-only-existing-draft-audit-selection",
      status:
        selected.length > 0
          ? "TARGETS_SELECTED"
          : unverified.length > 0
            ? "SELECTION_INCOMPLETE"
            : "NO_ELIGIBLE_TARGETS",
      executedAt: this.now().toISOString(),
      counts: {
        localCanonical: input.items.length,
        selected: selected.length,
        excluded: decisions.filter((decision) => decision.decision === "EXCLUDED").length,
        unverified: unverified.length
      },
      decisions,
      auditManifest:
        selected.length === 0
          ? null
          : {
              schemaVersion: 1,
              operation: "audit-existing-drafts",
              items: input.items
                .filter((item) => selected.some((decision) => decision.postId === item.postId))
                .map(({ blogPath, articlePath, postId, postEditorUrl, slug }) => ({
                  blogPath,
                  articlePath,
                  postId,
                  postEditorUrl,
                  slug
                }))
            }
    };
  }

  validatePreflight(items: ExistingDraftAuditSelectionItemInput[]): void {
    const postIds = new Set<string>();
    const editorUrls = new Set<string>();
    for (const item of items) {
      if (postIds.has(item.postId)) throw new Error(`Duplicate postId: ${item.postId}`);
      postIds.add(item.postId);
      if (editorUrls.has(item.postEditorUrl))
        throw new Error(`Duplicate postEditorUrl: ${item.postEditorUrl}`);
      editorUrls.add(item.postEditorUrl);
      if (item.slug !== item.article.slug)
        throw new Error(`Manifest slug does not match article slug for ${item.slug}`);
      const configuredBlogId = extractBloggerBlogId(item.blog.adminUrl);
      if (!configuredBlogId || configuredBlogId !== extractBloggerBlogId(item.postEditorUrl)) {
        throw new Error(`Editor URL does not belong to configured blog for ${item.slug}`);
      }
      if (extractBloggerPostId(item.postEditorUrl) !== item.postId) {
        throw new Error(`Editor URL postId does not match manifest postId for ${item.slug}`);
      }
    }
  }
}
