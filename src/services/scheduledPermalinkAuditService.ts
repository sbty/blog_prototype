import type { ExistingDraftInspection } from "../browser/bloggerDryRun.js";
import { extractBloggerBlogId, extractBloggerPostId } from "../browser/bloggerEditorIdentity.js";
import type { BlogConfig } from "../config/blogConfig.js";
import type { ArticleInput } from "../domain/article.js";
import { evaluatePersistedDraft, type DraftPersistenceCheck } from "../domain/draftPersistence.js";

export type ScheduledPermalinkAuditStatus = "PASS" | "FAIL" | "UNVERIFIED";
export type PermalinkClassification = "MATCH" | "EMPTY" | "DIFFERENT" | "UNVERIFIED";

export interface ScheduledPermalinkAuditTarget {
  batch: string;
  blog: BlogConfig;
  article: ArticleInput;
  postId: string;
  postEditorUrl: string;
  scheduledAtJst: string;
}

export interface ScheduledPermalinkAuditItem {
  batch: string;
  blogKey: string;
  slug: string;
  postId: string;
  postEditorUrl: string;
  expectedScheduledAtJst: string;
  status: ScheduledPermalinkAuditStatus;
  permalink: PermalinkClassification;
  actualState?: ExistingDraftInspection["postState"];
  actualScheduledAtJst?: string;
  checks?: Record<string, DraftPersistenceCheck>;
  reasons: string[];
  attempts: number;
  finalError?: string;
  auditedAt: string;
}

export interface ScheduledPermalinkAuditReport {
  schemaVersion: 1;
  auditType: "read-only-scheduled-permalink-audit";
  executedAt: string;
  counts: { total: number; pass: number; fail: number; unverified: number };
  byBlog: Record<string, { total: number; pass: number; fail: number; unverified: number }>;
  byScheduledDate: Record<
    string,
    { total: number; pass: number; fail: number; unverified: number }
  >;
  permalinkIssues: Array<
    Pick<
      ScheduledPermalinkAuditItem,
      "batch" | "blogKey" | "slug" | "postId" | "permalink" | "reasons"
    >
  >;
  items: ScheduledPermalinkAuditItem[];
}

export type ScheduledPermalinkRepairCategory =
  "PERMALINK_ONLY" | "CANONICAL_DIFFERENCE" | "CONNECTION_UNVERIFIED";

export const scheduledPermalinkAuditCheckNames = [
  "blogId",
  "postId",
  "editorUrl",
  "draftState",
  "scheduled",
  "published",
  "title",
  "body",
  "officialLinks",
  "labels",
  "searchDescription",
  "permalink",
  "imageCount",
  "scheduledAtJst"
] as const;

export interface ScheduledPermalinkReauditRepairReport {
  schemaVersion: 1;
  auditType: "read-only-scheduled-permalink-reaudit";
  executedAt: string;
  priorReportPath: string;
  reauditedPostIds: string[];
  counts: { total: number; pass: number; fail: number; unverified: number };
  candidates: Record<ScheduledPermalinkRepairCategory, ScheduledPermalinkAuditItem[]>;
  items: ScheduledPermalinkAuditItem[];
}

interface ScheduledInspectionClient {
  inspectExistingDraft(input: {
    adminUrl: string;
    postEditorUrl: string;
  }): Promise<ExistingDraftInspection>;
}

type ScheduledInspectionClientFactory = (blog: BlogConfig) => Promise<ScheduledInspectionClient>;

function normalizeJstDateTime(
  date: string | undefined,
  time: string | undefined
): string | undefined {
  if (!date || !time) return undefined;
  const match = date
    .trim()
    .replaceAll("-", "/")
    .match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  const timeMatch = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match || !timeMatch) return undefined;
  return `${match[1]}-${match[2]}-${match[3]} ${timeMatch[1].padStart(2, "0")}:${timeMatch[2]} JST`;
}

function isRetryableReadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /net::ERR_|timed?_?out|Target page, context or browser has been closed|fetch failed|HTTP 5\d\d|Blogger session is not ready/i.test(
    message
  );
}

function classifyPermalink(check: DraftPersistenceCheck | undefined): PermalinkClassification {
  if (!check) return "UNVERIFIED";
  if (check.status === "PASS") return "MATCH";
  if (check.actual === "") return "EMPTY";
  return "DIFFERENT";
}

function tally<T extends { status: ScheduledPermalinkAuditStatus }>(items: T[]) {
  return {
    total: items.length,
    pass: items.filter((item) => item.status === "PASS").length,
    fail: items.filter((item) => item.status === "FAIL").length,
    unverified: items.filter((item) => item.status === "UNVERIFIED").length
  };
}

function failedCheckNames(item: ScheduledPermalinkAuditItem): string[] {
  return Object.entries(item.checks ?? {})
    .filter(([, check]) => check.status === "FAIL")
    .map(([name]) => name);
}

export function validateScheduledPermalinkAuditItem(item: ScheduledPermalinkAuditItem): void {
  if (item.status === "UNVERIFIED") {
    if (item.permalink !== "UNVERIFIED") {
      throw new Error(`UNVERIFIED scheduled audit has verified permalink: ${item.postId}`);
    }
    return;
  }
  if (!item.checks) {
    throw new Error(`Verified scheduled audit is missing checks: ${item.postId}`);
  }
  if (scheduledPermalinkAuditCheckNames.some((name) => !item.checks?.[name])) {
    throw new Error(`Verified scheduled audit is missing required checks: ${item.postId}`);
  }
  if (
    extractBloggerPostId(item.postEditorUrl) !== item.postId ||
    item.checks.postId?.expected !== item.postId ||
    item.checks.editorUrl?.expected !== item.postEditorUrl ||
    item.checks.permalink?.expected !== item.slug ||
    item.checks.scheduledAtJst?.expected !== item.expectedScheduledAtJst
  ) {
    throw new Error(`Scheduled audit target evidence is inconsistent: ${item.postId}`);
  }
  const failures = failedCheckNames(item);
  if (item.status === "PASS" && failures.length > 0) {
    throw new Error(`PASS scheduled audit contains failed checks: ${item.postId}`);
  }
  if (item.status === "FAIL" && failures.length === 0) {
    throw new Error(`FAIL scheduled audit contains no failed checks: ${item.postId}`);
  }
  if (item.permalink !== classifyPermalink(item.checks.permalink)) {
    throw new Error(`Scheduled audit permalink classification is inconsistent: ${item.postId}`);
  }
}

export function buildScheduledPermalinkReauditRepairReport(input: {
  priorReportPath: string;
  priorItems: ScheduledPermalinkAuditItem[];
  reauditedItems: ScheduledPermalinkAuditItem[];
  now?: () => Date;
}): ScheduledPermalinkReauditRepairReport {
  for (const item of [...input.priorItems, ...input.reauditedItems]) {
    validateScheduledPermalinkAuditItem(item);
  }
  const priorByPostId = new Map<string, ScheduledPermalinkAuditItem>();
  for (const item of input.priorItems) {
    if (priorByPostId.has(item.postId)) {
      throw new Error(`Duplicate prior scheduled permalink audit post ID: ${item.postId}`);
    }
    priorByPostId.set(item.postId, item);
  }
  for (const item of input.reauditedItems) {
    const prior = priorByPostId.get(item.postId);
    if (!prior) {
      throw new Error(`Reaudit post is absent from the prior report: ${item.postId}`);
    }
    if (prior.status !== "UNVERIFIED") {
      throw new Error(`Reaudit includes a previously verified post: ${item.postId}`);
    }
    if (
      prior.batch !== item.batch ||
      prior.blogKey !== item.blogKey ||
      prior.slug !== item.slug ||
      prior.postEditorUrl !== item.postEditorUrl ||
      prior.expectedScheduledAtJst !== item.expectedScheduledAtJst
    ) {
      throw new Error(`Reaudit target identity changed from the prior report: ${item.postId}`);
    }
  }
  const reauditedPostIds = new Set(input.reauditedItems.map((item) => item.postId));
  const items = [
    ...input.priorItems.filter((item) => !reauditedPostIds.has(item.postId)),
    ...input.reauditedItems
  ];
  const postIds = new Set<string>();
  for (const item of items) {
    if (postIds.has(item.postId))
      throw new Error(`Duplicate scheduled permalink audit post ID: ${item.postId}`);
    postIds.add(item.postId);
  }
  const candidates: ScheduledPermalinkReauditRepairReport["candidates"] = {
    PERMALINK_ONLY: [],
    CANONICAL_DIFFERENCE: [],
    CONNECTION_UNVERIFIED: []
  };
  for (const item of items) {
    if (item.status === "UNVERIFIED") {
      candidates.CONNECTION_UNVERIFIED.push(item);
      continue;
    }
    if (item.status !== "FAIL") continue;
    const failures = failedCheckNames(item);
    if (item.permalink === "EMPTY" && failures.length === 1 && failures[0] === "permalink") {
      candidates.PERMALINK_ONLY.push(item);
    } else {
      candidates.CANONICAL_DIFFERENCE.push(item);
    }
  }
  return {
    schemaVersion: 1,
    auditType: "read-only-scheduled-permalink-reaudit",
    executedAt: (input.now ?? (() => new Date()))().toISOString(),
    priorReportPath: input.priorReportPath,
    reauditedPostIds: [...reauditedPostIds],
    counts: tally(items),
    candidates,
    items
  };
}

export class ScheduledPermalinkAuditService {
  constructor(
    private readonly clientFactory: ScheduledInspectionClientFactory,
    private readonly now: () => Date = () => new Date(),
    private readonly maxAttempts = 3,
    private readonly maxConcurrency = 4
  ) {}

  validatePreflight(targets: ScheduledPermalinkAuditTarget[]): void {
    const postIds = new Set<string>();
    const editorUrls = new Set<string>();
    for (const target of targets) {
      if (!/^\d{10,30}$/.test(target.postId))
        throw new Error(`Scheduled audit post ID must be numeric: ${target.article.slug}`);
      if (postIds.has(target.postId))
        throw new Error(`Duplicate scheduled audit post ID: ${target.postId}`);
      if (editorUrls.has(target.postEditorUrl))
        throw new Error(`Duplicate scheduled audit editor URL: ${target.postEditorUrl}`);
      const configuredBlogId = extractBloggerBlogId(target.blog.adminUrl);
      if (!configuredBlogId || configuredBlogId !== extractBloggerBlogId(target.postEditorUrl)) {
        throw new Error(
          `Scheduled audit target belongs to a different blog: ${target.article.slug}`
        );
      }
      if (extractBloggerPostId(target.postEditorUrl) !== target.postId) {
        throw new Error(`Scheduled audit editor URL post ID mismatch: ${target.article.slug}`);
      }
      if (!/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}\sJST$/.test(target.scheduledAtJst)) {
        throw new Error(
          `Scheduled audit time must use YYYY-MM-DD HH:mm JST: ${target.article.slug}`
        );
      }
      postIds.add(target.postId);
      editorUrls.add(target.postEditorUrl);
    }
  }

  async execute(targets: ScheduledPermalinkAuditTarget[]): Promise<ScheduledPermalinkAuditReport> {
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1) {
      throw new Error("Scheduled permalink audit maxAttempts must be a positive integer");
    }
    if (!Number.isInteger(this.maxConcurrency) || this.maxConcurrency < 1) {
      throw new Error("Scheduled permalink audit maxConcurrency must be a positive integer");
    }
    this.validatePreflight(targets);
    const items: ScheduledPermalinkAuditItem[] = [];
    for (let offset = 0; offset < targets.length; offset += this.maxConcurrency) {
      const targetGroup = targets.slice(offset, offset + this.maxConcurrency);
      items.push(...(await Promise.all(targetGroup.map((target) => this.auditTarget(target)))));
    }
    const byBlog: ScheduledPermalinkAuditReport["byBlog"] = {};
    const byScheduledDate: ScheduledPermalinkAuditReport["byScheduledDate"] = {};
    for (const item of items) {
      byBlog[item.blogKey] ??= { total: 0, pass: 0, fail: 0, unverified: 0 };
      const date = item.expectedScheduledAtJst.slice(0, 10);
      byScheduledDate[date] ??= { total: 0, pass: 0, fail: 0, unverified: 0 };
    }
    for (const key of Object.keys(byBlog)) {
      byBlog[key] = tally(items.filter((item) => item.blogKey === key));
    }
    for (const key of Object.keys(byScheduledDate)) {
      byScheduledDate[key] = tally(
        items.filter((item) => item.expectedScheduledAtJst.startsWith(key))
      );
    }
    return {
      schemaVersion: 1,
      auditType: "read-only-scheduled-permalink-audit",
      executedAt: this.now().toISOString(),
      counts: tally(items),
      byBlog,
      byScheduledDate,
      permalinkIssues: items
        .filter((item) => item.permalink !== "MATCH")
        .map(({ batch, blogKey, slug, postId, permalink, reasons }) => ({
          batch,
          blogKey,
          slug,
          postId,
          permalink,
          reasons
        })),
      items
    };
  }

  private async auditTarget(
    target: ScheduledPermalinkAuditTarget
  ): Promise<ScheduledPermalinkAuditItem> {
    let lastError: string | undefined;
    let actual: ExistingDraftInspection | undefined;
    let attempts = 0;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      attempts = attempt;
      try {
        actual = await (
          await this.clientFactory(target.blog)
        ).inspectExistingDraft({
          adminUrl: target.blog.adminUrl,
          postEditorUrl: target.postEditorUrl
        });
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (!isRetryableReadError(error)) break;
      }
    }
    const auditedAt = this.now().toISOString();
    if (!actual) {
      return {
        batch: target.batch,
        blogKey: target.blog.blogKey,
        slug: target.article.slug,
        postId: target.postId,
        postEditorUrl: target.postEditorUrl,
        expectedScheduledAtJst: target.scheduledAtJst,
        status: "UNVERIFIED",
        permalink: "UNVERIFIED",
        reasons: [lastError ?? "Scheduled post could not be inspected"],
        attempts,
        finalError: lastError,
        auditedAt
      };
    }
    const persistence = evaluatePersistedDraft({
      expectedBlogId: extractBloggerBlogId(target.blog.adminUrl),
      expectedPostId: target.postId,
      expectedEditUrl: target.postEditorUrl,
      article: target.article,
      actual,
      expectedPostState: "SCHEDULED"
    });
    const actualScheduledAtJst = normalizeJstDateTime(actual.scheduledDate, actual.scheduledTime);
    const scheduleCheck: DraftPersistenceCheck = {
      status: target.scheduledAtJst === actualScheduledAtJst ? "PASS" : "FAIL",
      expected: target.scheduledAtJst,
      actual: actualScheduledAtJst ?? null
    };
    const checks: Record<string, DraftPersistenceCheck> = {
      ...persistence.checks,
      scheduledAtJst: scheduleCheck
    };
    const reasons = Object.entries(checks)
      .filter(([, check]) => check.status === "FAIL")
      .map(([name]) => `${name}: expected and actual values differ`);
    return {
      batch: target.batch,
      blogKey: target.blog.blogKey,
      slug: target.article.slug,
      postId: target.postId,
      postEditorUrl: target.postEditorUrl,
      expectedScheduledAtJst: target.scheduledAtJst,
      status: reasons.length === 0 ? "PASS" : "FAIL",
      permalink: classifyPermalink(checks.permalink),
      actualState: actual.postState,
      actualScheduledAtJst,
      checks,
      reasons,
      attempts,
      auditedAt
    };
  }
}
