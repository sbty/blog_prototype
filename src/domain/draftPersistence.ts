import type { ArticleInput } from "./article.js";
import {
  extractAuditableExternalLinks,
  normalizeBloggerStoredHtml
} from "./bloggerStoredContentNormalization.js";

export interface PersistedDraftInspection {
  blogId: string;
  postId?: string;
  editUrl: string;
  postState: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "UNKNOWN";
  title: string;
  html: string;
  labels: string[];
  searchDescription: string;
  slug: string;
  imageCount: number;
}

export interface DraftPersistenceCheck {
  status: "PASS" | "FAIL";
  expected: unknown;
  actual: unknown;
}

export interface DraftPersistenceEvaluation {
  status: "PASS" | "FAIL";
  checks: Record<string, DraftPersistenceCheck>;
  reasons: string[];
}

function check(expected: unknown, actual: unknown): DraftPersistenceCheck {
  return {
    status: JSON.stringify(expected) === JSON.stringify(actual) ? "PASS" : "FAIL",
    expected,
    actual
  };
}

function normalizeLabels(labels: readonly string[]): string[] {
  return [...new Set(labels.map((label) => label.trim()).filter(Boolean))].sort();
}

/**
 * The common post-save gate. Its inspection must come from a newly opened
 * browser context; callers use the resulting checks to fail closed before a
 * draft is reported saved or used for scheduling.
 */
export function evaluatePersistedDraft(input: {
  expectedBlogId?: string;
  expectedPostId: string;
  expectedEditUrl: string;
  article: ArticleInput;
  actual: PersistedDraftInspection;
  expectedPostState?: "DRAFT" | "SCHEDULED";
}): DraftPersistenceEvaluation {
  const expectedPostState = input.expectedPostState ?? "DRAFT";
  const expectedImageCount = input.article.imagePath ? 1 : 0;
  const normalizedHtml = normalizeBloggerStoredHtml({
    expectedHtml: input.article.html,
    actualHtml: input.actual.html,
    expectedImageCount
  });
  const expectedLinks = extractAuditableExternalLinks(input.article.html, {
    stripLeadingBloggerImageWrapper: false
  });
  const actualLinks = extractAuditableExternalLinks(input.actual.html, {
    stripLeadingBloggerImageWrapper: expectedImageCount === 1
  });
  const checks: Record<string, DraftPersistenceCheck> = {
    blogId: check(input.expectedBlogId, input.actual.blogId),
    postId: check(input.expectedPostId, input.actual.postId),
    editorUrl: check(input.expectedEditUrl, input.actual.editUrl),
    draftState: check(expectedPostState, input.actual.postState),
    scheduled: check(expectedPostState === "SCHEDULED", input.actual.postState === "SCHEDULED"),
    published: check(false, input.actual.postState === "PUBLISHED"),
    title: check(input.article.title.trim(), input.actual.title.trim()),
    body: check(normalizedHtml.expected, normalizedHtml.actual),
    officialLinks: check(expectedLinks, actualLinks),
    labels: check(normalizeLabels(input.article.labels), normalizeLabels(input.actual.labels)),
    searchDescription: check(
      input.article.searchDescription.trim(),
      input.actual.searchDescription.trim()
    ),
    permalink: check(
      input.article.slug.trim().toLowerCase(),
      input.actual.slug.trim().toLowerCase()
    ),
    imageCount: check(expectedImageCount, input.actual.imageCount)
  };
  const reasons = Object.entries(checks)
    .filter(([, value]) => value.status === "FAIL")
    .map(
      ([name, value]) =>
        `${name}: expected ${JSON.stringify(value.expected)}, actual ${JSON.stringify(value.actual)}`
    );
  return { status: reasons.length === 0 ? "PASS" : "FAIL", checks, reasons };
}
