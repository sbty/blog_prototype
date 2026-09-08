import {
  type BloggerPostListEntry,
  type ExistingDraftInspection,
  BloggerDryRunClient
} from "../browser/bloggerDryRun.js";
import { extractBloggerBlogId } from "../browser/bloggerEditorIdentity.js";
import { loadBloggerSelectors } from "../browser/bloggerSelectors.js";
import type { BlogConfig } from "../config/blogConfig.js";
import type { AppConfig } from "../config/env.js";
import type { ArticleInput } from "../domain/article.js";
import {
  extractAuditableExternalLinks,
  normalizeBloggerStoredHtml
} from "../domain/bloggerStoredContentNormalization.js";
import {
  PublishedPostAuditService,
  type PublishedPostAuditResult
} from "./publishedPostAuditService.js";

export interface PublishedPostCompleteAuditCheck {
  status: "PASS" | "FAIL";
  expected: unknown;
  actual: unknown;
}

export interface PublishedPostCompleteAuditReport {
  schemaVersion: 1;
  auditType: "read-only-published-post-complete-audit";
  status: "PASS" | "FAIL";
  auditedAt: string;
  actual: ExistingDraftInspection;
  publicAudit: PublishedPostAuditResult | null;
  checks: Record<string, PublishedPostCompleteAuditCheck>;
  reasons: string[];
}

interface PublishedInspectionClient {
  inspectExistingDraft(input: {
    adminUrl: string;
    postEditorUrl: string;
  }): Promise<ExistingDraftInspection>;
  listPosts(input: {
    adminUrl: string;
  }): Promise<{ blogId: string; posts: BloggerPostListEntry[] }>;
}

type PublishedInspectionClientFactory = (blog: BlogConfig) => Promise<PublishedInspectionClient>;
type PublicAudit = (input: {
  blog: BlogConfig;
  article: ArticleInput;
  postId: string;
}) => Promise<PublishedPostAuditResult>;

function normalizeLabels(labels: readonly string[]): string[] {
  return [...new Set(labels.map((label) => label.trim()).filter(Boolean))].sort();
}

function check(expected: unknown, actual: unknown): PublishedPostCompleteAuditCheck {
  return {
    status: JSON.stringify(expected) === JSON.stringify(actual) ? "PASS" : "FAIL",
    expected,
    actual
  };
}

function isTransientPublicReadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /net::ERR_|timed?_?out|fetch failed|HTTP 5\d\d/i.test(message);
}

export class PublishedPostCompleteAuditService {
  constructor(
    private readonly config: AppConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly clientFactory: PublishedInspectionClientFactory = async (blog) =>
      new BloggerDryRunClient(this.config, await loadBloggerSelectors(blog.blogger.selectorsPath)),
    private readonly publicAudit: PublicAudit = (input) =>
      new PublishedPostAuditService().execute(input)
  ) {}

  async execute(input: {
    blog: BlogConfig;
    article: ArticleInput;
    postId: string;
    postEditorUrl: string;
  }): Promise<PublishedPostCompleteAuditReport> {
    const client = await this.clientFactory(input.blog);
    const [actual, postList] = await Promise.all([
      client.inspectExistingDraft({
        adminUrl: input.blog.adminUrl,
        postEditorUrl: input.postEditorUrl
      }),
      client.listPosts({ adminUrl: input.blog.adminUrl })
    ]);
    let publicAudit: PublishedPostAuditResult | null = null;
    let publicAuditError: string | null = null;
    try {
      publicAudit = await this.publicAudit({
        blog: input.blog,
        article: input.article,
        postId: input.postId
      });
    } catch (error) {
      if (isTransientPublicReadError(error)) throw error;
      publicAuditError = error instanceof Error ? error.message : String(error);
    }

    const expectedImageCount = input.article.imagePath ? 1 : 0;
    const normalizedHtml = normalizeBloggerStoredHtml({
      expectedHtml: input.article.html,
      actualHtml: actual.html,
      expectedImageCount
    });
    const expectedLinks = extractAuditableExternalLinks(input.article.html, {
      stripLeadingBloggerImageWrapper: false
    });
    const actualLinks = extractAuditableExternalLinks(actual.html, {
      stripLeadingBloggerImageWrapper: expectedImageCount === 1
    });
    const verifiedPublicPublication = Boolean(
      publicAudit &&
      publicAudit.postId === input.postId &&
      publicAudit.publicUrl &&
      Number.isFinite(Date.parse(publicAudit.publishedAt))
    );
    const duplicatePostIds = postList.posts
      .filter((post) => post.title === input.article.title)
      .map((post) => post.postId)
      .filter((postId): postId is string => Boolean(postId))
      .sort();
    const checks: Record<string, PublishedPostCompleteAuditCheck> = {
      blogId: check(extractBloggerBlogId(input.blog.adminUrl), actual.blogId),
      postId: check(input.postId, actual.postId),
      editorUrl: check(input.postEditorUrl, actual.editUrl),
      published: check("PUBLISHED", verifiedPublicPublication ? "PUBLISHED" : actual.postState),
      title: check(input.article.title.trim(), actual.title.trim()),
      body: check(normalizedHtml.expected, normalizedHtml.actual),
      officialLinks: check(expectedLinks, actualLinks),
      labels: check(normalizeLabels(input.article.labels), normalizeLabels(actual.labels)),
      searchDescription: check(
        input.article.searchDescription.trim(),
        actual.searchDescription.trim()
      ),
      permalink: check(input.article.slug.trim().toLowerCase(), actual.slug.trim().toLowerCase()),
      imageCount: check(expectedImageCount, actual.imageCount),
      duplicateTitle: check([input.postId], duplicatePostIds),
      publicPage: check(true, verifiedPublicPublication),
      publicPostId: check(input.postId, publicAudit?.postId ?? null),
      publicPublishedAt: check(
        "valid timestamp",
        publicAudit && Number.isFinite(Date.parse(publicAudit.publishedAt))
          ? "valid timestamp"
          : null
      ),
      publicContent: check(true, publicAudit?.contentPresent ?? false),
      publicImage: check(1, publicAudit?.imageCount ?? 0)
    };
    if (publicAuditError) checks.publicPage = check("readable public page", publicAuditError);
    const reasons = Object.entries(checks)
      .filter(([, value]) => value.status === "FAIL")
      .map(
        ([name, value]) =>
          `${name}: expected ${JSON.stringify(value.expected)}, actual ${JSON.stringify(value.actual)}`
      );
    return {
      schemaVersion: 1,
      auditType: "read-only-published-post-complete-audit",
      status: reasons.length === 0 ? "PASS" : "FAIL",
      auditedAt: this.now().toISOString(),
      actual,
      publicAudit,
      checks,
      reasons
    };
  }
}
