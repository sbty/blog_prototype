import { isDeepStrictEqual } from "node:util";
import {
  type ScheduledPermalinkAuditItem,
  type ScheduledPermalinkRepairCategory,
  scheduledPermalinkAuditCheckNames,
  validateScheduledPermalinkAuditItem
} from "./scheduledPermalinkAuditService.js";

export interface ScheduledPermalinkCanonicalSource {
  batch: string;
  blogKey: string;
  slug: string;
  postId: string;
  postEditorUrl: string;
  blogPath: string;
  articlePath: string;
}

export interface ScheduledPermalinkRepairPreparationReport {
  schemaVersion: 1;
  packageType: "approval-only-scheduled-permalink-repair";
  preparedAt: string;
  sources: { auditReportPath: string; selectionManifestPath: string };
  counts: {
    totalAudited: number;
    repairCandidates: number;
    canonicalDifferenceExcluded: number;
    connectionUnverifiedExcluded: number;
    alreadyCompliant: number;
  };
  repairManifest: {
    operation: "set-custom-permalink-only";
    requiresExplicitApproval: true;
    targets: Array<{
      batch: string;
      blogKey: string;
      slug: string;
      postId: string;
      postEditorUrl: string;
      scheduledAtJst: string;
      title: string;
      currentPermalink: unknown;
      canonicalSource: Pick<ScheduledPermalinkCanonicalSource, "blogPath" | "articlePath">;
      auditChecks: NonNullable<ScheduledPermalinkAuditItem["checks"]>;
      preflightChecks: string[];
      postSaveChecks: string[];
      stopConditions: string[];
    }>;
  };
  exclusions: {
    canonicalDifference: Array<{
      postId: string;
      blogKey: string;
      slug: string;
      scheduledAtJst: string;
      canonicalSource: Pick<ScheduledPermalinkCanonicalSource, "blogPath" | "articlePath">;
      nonPermalinkDifferences: string[];
      reason: string;
    }>;
    connectionUnverified: Array<{
      postId: string;
      blogKey: string;
      slug: string;
      scheduledAtJst: string;
      attempts: number;
      reason: string;
    }>;
    alreadyCompliant: Array<
      Pick<ScheduledPermalinkAuditItem, "postId" | "blogKey" | "slug" | "expectedScheduledAtJst">
    >;
  };
}

function failedCheckNames(item: ScheduledPermalinkAuditItem): string[] {
  return Object.entries(item.checks ?? {})
    .filter(([, check]) => check.status === "FAIL")
    .map(([name]) => name);
}

function sourceKey(item: Pick<ScheduledPermalinkAuditItem, "batch" | "blogKey" | "slug">): string {
  return `${item.batch}\0${item.blogKey}\0${item.slug}`;
}

export class ScheduledPermalinkRepairPreparationService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  prepare(input: {
    auditReportPath: string;
    selectionManifestPath: string;
    items: ScheduledPermalinkAuditItem[];
    candidates: Record<ScheduledPermalinkRepairCategory, ScheduledPermalinkAuditItem[]>;
    canonicalSources: ScheduledPermalinkCanonicalSource[];
  }): ScheduledPermalinkRepairPreparationReport {
    const canonicalByKey = new Map<string, ScheduledPermalinkCanonicalSource>();
    const canonicalPostIds = new Set<string>();
    const canonicalEditorUrls = new Set<string>();
    for (const source of input.canonicalSources) {
      const key = sourceKey(source);
      if (canonicalByKey.has(key)) {
        throw new Error(`Duplicate scheduled permalink canonical source: ${source.slug}`);
      }
      if (canonicalPostIds.has(source.postId)) {
        throw new Error(`Duplicate scheduled permalink canonical post ID: ${source.postId}`);
      }
      if (canonicalEditorUrls.has(source.postEditorUrl)) {
        throw new Error(
          `Duplicate scheduled permalink canonical editor URL: ${source.postEditorUrl}`
        );
      }
      canonicalByKey.set(key, source);
      canonicalPostIds.add(source.postId);
      canonicalEditorUrls.add(source.postEditorUrl);
    }
    const auditedByPostId = new Map<string, ScheduledPermalinkAuditItem>();
    const seenPostIds = new Set<string>();
    for (const item of input.items) {
      validateScheduledPermalinkAuditItem(item);
      if (seenPostIds.has(item.postId))
        throw new Error(`Duplicate scheduled permalink preparation post ID: ${item.postId}`);
      seenPostIds.add(item.postId);
      auditedByPostId.set(item.postId, item);
    }
    const getSource = (item: ScheduledPermalinkAuditItem) => {
      const source = canonicalByKey.get(sourceKey(item));
      if (!source || source.postId !== item.postId || source.postEditorUrl !== item.postEditorUrl) {
        throw new Error(
          `Scheduled permalink preparation canonical mismatch: ${item.batch}/${item.slug}`
        );
      }
      return source;
    };
    for (const item of input.items) getSource(item);
    const permalinkOnly = input.candidates.PERMALINK_ONLY;
    const canonicalDifference = input.candidates.CANONICAL_DIFFERENCE;
    const connectionUnverified = input.candidates.CONNECTION_UNVERIFIED;
    const candidateIds = new Set(
      [...permalinkOnly, ...canonicalDifference, ...connectionUnverified].map((item) => item.postId)
    );
    if (
      candidateIds.size !==
      permalinkOnly.length + canonicalDifference.length + connectionUnverified.length
    ) {
      throw new Error("Scheduled permalink preparation candidates contain duplicate post IDs");
    }
    const candidateCategoryByPostId = new Map<string, ScheduledPermalinkRepairCategory>();
    for (const [category, items] of Object.entries({
      PERMALINK_ONLY: permalinkOnly,
      CANONICAL_DIFFERENCE: canonicalDifference,
      CONNECTION_UNVERIFIED: connectionUnverified
    }) as Array<[ScheduledPermalinkRepairCategory, ScheduledPermalinkAuditItem[]]>) {
      for (const item of items) {
        const audited = auditedByPostId.get(item.postId);
        if (!audited || !isDeepStrictEqual(audited, item)) {
          throw new Error(
            `Scheduled permalink candidate does not match audit item: ${item.postId}`
          );
        }
        candidateCategoryByPostId.set(item.postId, category);
      }
    }
    for (const item of permalinkOnly) {
      const failures = failedCheckNames(item);
      const checks = item.checks ?? {};
      if (
        item.status !== "FAIL" ||
        item.permalink !== "EMPTY" ||
        failures.length !== 1 ||
        failures[0] !== "permalink" ||
        checks.permalink?.actual !== "" ||
        scheduledPermalinkAuditCheckNames.some((name) => !checks[name]) ||
        scheduledPermalinkAuditCheckNames.some(
          (name) => name !== "permalink" && checks[name]?.status !== "PASS"
        )
      ) {
        throw new Error(`Scheduled permalink-only candidate is not eligible: ${item.postId}`);
      }
    }
    for (const item of canonicalDifference) {
      const failures = failedCheckNames(item);
      if (
        item.status !== "FAIL" ||
        failures.length === 0 ||
        (item.permalink === "EMPTY" && failures.every((name) => name === "permalink"))
      ) {
        throw new Error(`Scheduled canonical-difference exclusion is invalid: ${item.postId}`);
      }
    }
    for (const item of connectionUnverified) {
      if (item.status !== "UNVERIFIED")
        throw new Error(`Scheduled connection exclusion is invalid: ${item.postId}`);
    }
    for (const item of input.items) {
      const failures = failedCheckNames(item);
      const expectedCategory: ScheduledPermalinkRepairCategory | undefined =
        item.status === "UNVERIFIED"
          ? "CONNECTION_UNVERIFIED"
          : item.status === "FAIL"
            ? item.permalink === "EMPTY" && failures.length === 1 && failures[0] === "permalink"
              ? "PERMALINK_ONLY"
              : "CANONICAL_DIFFERENCE"
            : undefined;
      if (candidateCategoryByPostId.get(item.postId) !== expectedCategory) {
        throw new Error(
          `Scheduled permalink candidate classification is incomplete: ${item.postId}`
        );
      }
    }
    const repairTargets = permalinkOnly.map((item) => {
      const source = getSource(item);
      const checks = item.checks ?? {};
      return {
        batch: item.batch,
        blogKey: item.blogKey,
        slug: item.slug,
        postId: item.postId,
        postEditorUrl: item.postEditorUrl,
        scheduledAtJst: item.expectedScheduledAtJst,
        title: String(checks.title?.actual ?? ""),
        currentPermalink: checks.permalink?.actual ?? null,
        canonicalSource: { blogPath: source.blogPath, articlePath: source.articlePath },
        auditChecks: checks,
        preflightChecks: [
          "投稿ID・ブログID・編集URLが監査済み値と一致する",
          "投稿は公開済みでなく、予約状態かつ予約日時が scheduledAtJst と一致する",
          "タイトル、本文、公式情報リンク、ラベル、検索説明、画像数が auditChecks のPASS値と一致する",
          "現在のパーマリンクが空である"
        ],
        postSaveChecks: [
          "新しいブラウザコンテキストで再読込する",
          "正本slugとパーマリンクが完全一致する",
          "予約状態と予約日時が保存前と一致する",
          "タイトル、本文、公式情報リンク、ラベル、検索説明、画像数が保存前の監査値と一致する"
        ],
        stopConditions: [
          "投稿ID・ブログID・編集URL・予約日時のいずれかが不一致",
          "公開済み、予約解除、または保存前の非パーマリンク項目が不一致",
          "保存後にパーマリンクが空・別slug、または予約日時・監査値が変化"
        ]
      };
    });
    const alreadyCompliant = input.items
      .filter((item) => !candidateIds.has(item.postId) && item.status === "PASS")
      .map(({ postId, blogKey, slug, expectedScheduledAtJst }) => ({
        postId,
        blogKey,
        slug,
        expectedScheduledAtJst
      }));
    return {
      schemaVersion: 1,
      packageType: "approval-only-scheduled-permalink-repair",
      preparedAt: this.now().toISOString(),
      sources: {
        auditReportPath: input.auditReportPath,
        selectionManifestPath: input.selectionManifestPath
      },
      counts: {
        totalAudited: input.items.length,
        repairCandidates: repairTargets.length,
        canonicalDifferenceExcluded: canonicalDifference.length,
        connectionUnverifiedExcluded: connectionUnverified.length,
        alreadyCompliant: alreadyCompliant.length
      },
      repairManifest: {
        operation: "set-custom-permalink-only",
        requiresExplicitApproval: true,
        targets: repairTargets
      },
      exclusions: {
        canonicalDifference: canonicalDifference.map((item) => {
          const source = getSource(item);
          return {
            postId: item.postId,
            blogKey: item.blogKey,
            slug: item.slug,
            scheduledAtJst: item.expectedScheduledAtJst,
            canonicalSource: { blogPath: source.blogPath, articlePath: source.articlePath },
            nonPermalinkDifferences: failedCheckNames(item).filter((name) => name !== "permalink"),
            reason: "パーマリンク以外にローカル正本との差分があり、正本の確定前に保存できない"
          };
        }),
        connectionUnverified: connectionUnverified.map((item) => ({
          postId: item.postId,
          blogKey: item.blogKey,
          slug: item.slug,
          scheduledAtJst: item.expectedScheduledAtJst,
          attempts: item.attempts,
          reason: item.finalError ?? item.reasons.join(" | ")
        })),
        alreadyCompliant
      }
    };
  }
}
