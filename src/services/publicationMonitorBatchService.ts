import type { ArticleInput } from "../domain/article.js";
import type { BlogConfig } from "../config/blogConfig.js";
import type { PublishedPostCompleteAuditReport } from "./publishedPostCompleteAuditService.js";

export type PublicationMonitorStatus = "PENDING" | "PASS" | "FAIL" | "UNVERIFIED";

export interface PublicationMonitorItem {
  slug: string;
  blogKey: string;
  postId: string;
  scheduledAtJst: string;
  status: PublicationMonitorStatus;
  auditAttempts?: number;
  finalError?: string;
  auditedAt?: string;
  auditReport?: string;
  [key: string]: unknown;
}

export interface PublicationMonitorFile {
  schemaVersion: number;
  purpose: string;
  status: string;
  timezone: string;
  counts: Record<string, number>;
  items: PublicationMonitorItem[];
  [key: string]: unknown;
}

export interface PublicationMonitorCanonicalItem {
  batch: string;
  slug: string;
  blog: BlogConfig;
  article: ArticleInput;
  postId: string;
  postEditorUrl: string;
}

export interface PublicationMonitorSource {
  batch: string;
  path: string;
  monitor: PublicationMonitorFile;
}

export interface PublicationMonitorDecision {
  batch: string;
  monitorPath: string;
  blogKey: string;
  slug: string;
  postId: string;
  scheduledAtJst: string;
  decision: "SKIPPED" | "PASS" | "FAIL" | "UNVERIFIED";
  reason: string;
  attempts: number;
  finalError?: string;
  auditedAt?: string;
  audit?: PublishedPostCompleteAuditReport;
}

export interface PublicationMonitorBatchReport {
  schemaVersion: 1;
  auditType: "read-only-publication-monitor-batch";
  executedAt: string;
  counts: { total: number; skipped: number; pass: number; fail: number; unverified: number };
  decisions: PublicationMonitorDecision[];
}

export interface PublicationMonitorRetryOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface PublicationMonitorAuditor {
  audit(input: PublicationMonitorCanonicalItem): Promise<PublishedPostCompleteAuditReport>;
}

interface Attempt<T> {
  ok: boolean;
  attempts: number;
  value?: T;
  error?: string;
}

function isRetryableReadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /net::ERR_|timed?_?out|Target page, context or browser has been closed|fetch failed|HTTP 5\d\d|Blogger session is not ready/i.test(
    message
  );
}

async function retryReadOnly<T>(
  operation: () => Promise<T>,
  options: Required<PublicationMonitorRetryOptions>
): Promise<Attempt<T>> {
  let lastError: unknown;
  let attempts = 0;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      return { ok: true, attempts, value: await operation() };
    } catch (error) {
      lastError = error;
      if (attempt === options.maxAttempts || !isRetryableReadError(error)) break;
      if (options.retryDelayMs > 0)
        await new Promise<void>((resolve) => setTimeout(resolve, options.retryDelayMs));
    }
  }
  return {
    ok: false,
    attempts,
    error: lastError instanceof Error ? lastError.message : String(lastError)
  };
}

function parseScheduledAtJst(value: string): Date {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s+JST$/);
  if (!match) throw new Error(`scheduledAtJst must use YYYY-MM-DD HH:mm JST: ${value}`);
  const [, year, month, day, hour, minute] = match;
  return new Date(Date.UTC(+year, +month - 1, +day, +hour - 9, +minute));
}

function key(...parts: string[]): string {
  return parts.join("\u0000");
}

function updatedCounts(
  original: Record<string, number>,
  items: PublicationMonitorItem[]
): Record<string, number> {
  const pending = items.filter((item) => item.status === "PENDING").length;
  const pass = items.filter((item) => item.status === "PASS").length;
  const fail = items.filter((item) => item.status === "FAIL").length;
  const unverified = items.filter((item) => item.status === "UNVERIFIED").length;
  const counts: Record<string, number> = { ...original, total: items.length, pending, unverified };
  if ("completed" in original) {
    counts.completed = items.length - pending;
    counts.failed = fail;
  } else {
    counts.pass = pass;
    counts.fail = fail;
  }
  return counts;
}

export class PublicationMonitorBatchService {
  constructor(
    private readonly auditor: PublicationMonitorAuditor,
    private readonly now: () => Date = () => new Date(),
    private readonly retryOptions: PublicationMonitorRetryOptions = {}
  ) {}

  validatePreflight(input: {
    monitors: PublicationMonitorSource[];
    canonicalItems: PublicationMonitorCanonicalItem[];
  }): void {
    const paths = new Set<string>();
    const postIds = new Set<string>();
    const canonicalByKey = new Map(
      input.canonicalItems.map((item) => [key(item.batch, item.blog.blogKey, item.slug), item])
    );
    for (const source of input.monitors) {
      if (paths.has(source.path)) throw new Error(`Duplicate monitor path: ${source.path}`);
      paths.add(source.path);
      if (source.monitor.timezone !== "Asia/Tokyo")
        throw new Error(`Monitor timezone must be Asia/Tokyo: ${source.path}`);
      for (const item of source.monitor.items) {
        if (!/^\d{10,30}$/.test(item.postId))
          throw new Error(`Monitor postId must be numeric: ${item.slug}`);
        parseScheduledAtJst(item.scheduledAtJst);
        if (postIds.has(item.postId)) throw new Error(`Duplicate monitor postId: ${item.postId}`);
        postIds.add(item.postId);
        const canonical = canonicalByKey.get(key(source.batch, item.blogKey, item.slug));
        if (!canonical)
          throw new Error(
            `Monitor item has no local canonical source: ${source.batch}/${item.slug}`
          );
        if (canonical.postId !== item.postId)
          throw new Error(`Monitor postId does not match local canonical source: ${item.slug}`);
      }
    }
  }

  async execute(input: {
    monitors: PublicationMonitorSource[];
    canonicalItems: PublicationMonitorCanonicalItem[];
    retryUnverified?: boolean;
  }): Promise<{ report: PublicationMonitorBatchReport; monitors: PublicationMonitorSource[] }> {
    this.validatePreflight(input);
    const options: Required<PublicationMonitorRetryOptions> = {
      maxAttempts: this.retryOptions.maxAttempts ?? 3,
      retryDelayMs: this.retryOptions.retryDelayMs ?? 250
    };
    const canonicalByKey = new Map(
      input.canonicalItems.map((item) => [key(item.batch, item.blog.blogKey, item.slug), item])
    );
    const decisions: PublicationMonitorDecision[] = [];
    const updatedSources: PublicationMonitorSource[] = [];
    const dueThreshold = this.now().getTime() - 30 * 60 * 1000;

    for (const source of input.monitors) {
      const updatedItems: PublicationMonitorItem[] = [];
      for (const item of source.monitor.items) {
        if (item.status !== "PENDING" && !(input.retryUnverified && item.status === "UNVERIFIED")) {
          updatedItems.push({ ...item });
          continue;
        }
        if (parseScheduledAtJst(item.scheduledAtJst).getTime() > dueThreshold) {
          decisions.push({
            batch: source.batch,
            monitorPath: source.path,
            blogKey: item.blogKey,
            slug: item.slug,
            postId: item.postId,
            scheduledAtJst: item.scheduledAtJst,
            decision: "SKIPPED",
            reason: "Scheduled time has not been reached by 30 minutes",
            attempts: 0
          });
          updatedItems.push({ ...item });
          continue;
        }
        const canonical = canonicalByKey.get(key(source.batch, item.blogKey, item.slug));
        if (!canonical) throw new Error(`Missing canonical item after preflight: ${item.slug}`);
        const attempt = await retryReadOnly(() => this.auditor.audit(canonical), options);
        const base = {
          batch: source.batch,
          monitorPath: source.path,
          blogKey: item.blogKey,
          slug: item.slug,
          postId: item.postId,
          scheduledAtJst: item.scheduledAtJst
        };
        if (!attempt.ok || !attempt.value) {
          decisions.push({
            ...base,
            decision: "UNVERIFIED",
            reason: "Publication could not be verified after bounded read-only retries",
            attempts: attempt.attempts,
            finalError: attempt.error
          });
          updatedItems.push({
            ...item,
            status: "UNVERIFIED",
            auditAttempts: attempt.attempts,
            finalError: attempt.error,
            auditedAt: this.now().toISOString()
          });
          continue;
        }
        const audit = attempt.value;
        const decision = audit.status === "PASS" ? "PASS" : "FAIL";
        decisions.push({
          ...base,
          decision,
          reason:
            decision === "PASS"
              ? "Published post matches the local canonical article"
              : audit.reasons.join("; "),
          attempts: attempt.attempts,
          auditedAt: audit.auditedAt,
          audit
        });
        updatedItems.push({
          ...item,
          status: decision,
          auditAttempts: attempt.attempts,
          auditedAt: audit.auditedAt,
          auditReport: `inline:${audit.auditType}`,
          ...(decision === "FAIL" ? { finalError: audit.reasons.join("; ") } : {})
        });
      }
      updatedSources.push({
        ...source,
        monitor: {
          ...source.monitor,
          counts: updatedCounts(source.monitor.counts, updatedItems),
          items: updatedItems
        }
      });
    }
    const count = (decision: PublicationMonitorDecision["decision"]) =>
      decisions.filter((item) => item.decision === decision).length;
    return {
      report: {
        schemaVersion: 1,
        auditType: "read-only-publication-monitor-batch",
        executedAt: this.now().toISOString(),
        counts: {
          total: decisions.length,
          skipped: count("SKIPPED"),
          pass: count("PASS"),
          fail: count("FAIL"),
          unverified: count("UNVERIFIED")
        },
        decisions
      },
      monitors: updatedSources
    };
  }
}
