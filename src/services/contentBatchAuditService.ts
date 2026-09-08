import { validateImageFile, type ValidatedImageFile } from "../browser/imageFile.js";
import { batchManifestSchema } from "../domain/batch.js";
import { z } from "zod";

export type ContentAuditSeverity = "ERROR" | "WARNING";

export interface ContentAuditIssue {
  code: string;
  severity: ContentAuditSeverity;
  message: string;
}

export interface ContentBatchAuditItem {
  index: number;
  blogKey: string;
  slug: string;
  status: "PASS" | "FAIL";
  metrics: {
    textLength: number;
    targetLengthMin: number;
    targetLengthMax: number;
    sourceCount: number;
    citedSourceCount: number;
    labelCount: number;
    imageBytes: number | null;
  };
  issues: ContentAuditIssue[];
}

export interface ContentBatchAuditResult {
  schemaVersion: 1;
  generatedAt: string;
  status: "PASS" | "FAIL";
  counts: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    warnings: number;
  };
  items: ContentBatchAuditItem[];
}

export const contentBatchAuditResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().datetime({ offset: true }),
    status: z.enum(["PASS", "FAIL"]),
    counts: z
      .object({
        total: z.number().int().nonnegative(),
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative()
      })
      .strict(),
    items: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          blogKey: z.string().trim().min(1).max(200),
          slug: z.string().trim().min(1).max(100),
          status: z.enum(["PASS", "FAIL"]),
          metrics: z
            .object({
              textLength: z.number().int().nonnegative(),
              targetLengthMin: z.number().int().nonnegative(),
              targetLengthMax: z.number().int().nonnegative(),
              sourceCount: z.number().int().nonnegative(),
              citedSourceCount: z.number().int().nonnegative(),
              labelCount: z.number().int().nonnegative(),
              imageBytes: z.number().int().nonnegative().nullable()
            })
            .strict(),
          issues: z.array(
            z
              .object({
                code: z.string().trim().min(1).max(200),
                severity: z.enum(["ERROR", "WARNING"]),
                message: z.string().trim().min(1).max(2000)
              })
              .strict()
          )
        })
        .strict()
    )
  })
  .strict()
  .superRefine((result, context) => {
    const failed = result.items.filter((item) => item.status === "FAIL").length;
    const errors = result.items
      .flatMap((item) => item.issues)
      .filter((issue) => issue.severity === "ERROR").length;
    const warnings = result.items
      .flatMap((item) => item.issues)
      .filter((issue) => issue.severity === "WARNING").length;
    const consistent =
      result.counts.total === result.items.length &&
      result.counts.failed === failed &&
      result.counts.passed === result.items.length - failed &&
      result.counts.errors === errors &&
      result.counts.warnings === warnings &&
      result.status === (failed === 0 ? "PASS" : "FAIL");
    if (!consistent) {
      context.addIssue({ code: "custom", message: "Content audit counts are inconsistent" });
    }
    result.items.forEach((item, index) => {
      const hasError = item.issues.some((issue) => issue.severity === "ERROR");
      if (item.index !== index || item.status !== (hasError ? "FAIL" : "PASS")) {
        context.addIssue({
          code: "custom",
          path: ["items", index],
          message: "Content audit item index or status is inconsistent"
        });
      }
    });
  });

type ImageValidator = (imagePath: string) => Promise<ValidatedImageFile>;

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    if (token.startsWith("#x") || token.startsWith("#X")) {
      return safeCodePoint(Number.parseInt(token.slice(2), 16));
    }
    if (token.startsWith("#")) {
      return safeCodePoint(Number.parseInt(token.slice(1), 10));
    }
    return named[token.toLowerCase()] ?? " ";
  });
}

function safeCodePoint(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : " ";
}

function visibleText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function contentLength(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function normalizeUrl(value: string): string {
  return new URL(value).href;
}

function citedUrls(html: string): Set<string> {
  const urls = new Set<string>();
  const pattern = /\bhref\s*=\s*(["'])(.*?)\1/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const url = new URL(decodeHtmlEntities(match[2]));
      if (url.protocol === "https:" && !url.username && !url.password) urls.add(url.href);
    } catch {
      // Article validation permits relative links; only absolute HTTPS citations count here.
    }
  }
  return urls;
}

const genericBoilerplateMarkers = [
  "まずは対象を固定して確認する",
  "確認手順を分ける",
  "判断に使う基準",
  "実行前の最終チェックリスト",
  "確認結果の読み方",
  "製品型番、ソフトウェアの版、利用地域、利用時点によって前提が変わります",
  "機器・アカウント・旅程を一つずつ書き出します"
];

const unrelatedDomainSignals = [
  {
    name: "travel",
    minimumTerms: 2,
    terms: ["旅行", "旅程", "渡航", "入国", "出発", "航空券", "パスポート", "itinerary", "flight"]
  },
  {
    name: "account",
    // Account ownership and sign-in can be intrinsic to software, game, and DRM articles.
    // Require the broader generic cluster before treating it as an unrelated add-on.
    minimumTerms: 3,
    terms: ["アカウント", "ログイン", "パスワード", "プロフィール", "account", "login", "password"]
  },
  {
    name: "hardware",
    minimumTerms: 2,
    terms: ["製品型番", "マザーボード", "cpu", "gpu", "ケーブル", "充電器"]
  }
] as const;

function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("und");
}

function contentBriefText(item: {
  article: { title: string };
  provenance?: {
    contentBrief?: { topic: string; searchIntent: string; requiredPoints: string[] };
  };
}): string {
  const brief = item.provenance?.contentBrief;
  return normalizeForMatch(
    [item.article.title, brief?.topic, brief?.searchIntent, ...(brief?.requiredPoints ?? [])]
      .filter(Boolean)
      .join(" ")
  );
}

function genericBoilerplateMatches(text: string): string[] {
  const normalized = normalizeForMatch(text);
  return genericBoilerplateMarkers.filter((marker) =>
    normalized.includes(normalizeForMatch(marker))
  );
}

function unanchoredDomainSignals(
  html: string,
  item: {
    article: { title: string };
    provenance?: {
      contentBrief?: { topic: string; searchIntent: string; requiredPoints: string[] };
    };
  }
): string[] {
  const anchors = contentBriefText(item);
  const blocks = html
    .split(/(?=<h[2-6]\b)/i)
    .map(visibleText)
    .filter(Boolean);
  const signals = new Set<string>();
  for (const block of blocks) {
    const normalizedBlock = normalizeForMatch(block);
    for (const domain of unrelatedDomainSignals) {
      const termsInBlock = domain.terms.filter((term) => normalizedBlock.includes(term));
      const domainIsAnchored = domain.terms.some((term) => anchors.includes(term));
      if (termsInBlock.length >= domain.minimumTerms && !domainIsAnchored) {
        signals.add(domain.name);
      }
    }
  }
  return [...signals];
}

export class ContentBatchAuditService {
  constructor(private readonly validateImage: ImageValidator = validateImageFile) {}

  async execute(input: unknown): Promise<ContentBatchAuditResult> {
    const batch = batchManifestSchema.parse(input);
    const blogs = new Map(batch.blogs.map((blog) => [blog.blogKey, blog]));
    const items = await Promise.all(
      batch.items.map(async (item, index): Promise<ContentBatchAuditItem> => {
        const blog = blogs.get(item.blogKey)!;
        const text = visibleText(item.article.html);
        const textLength = contentLength(text);
        const issues: ContentAuditIssue[] = [];
        const sources = item.provenance?.sourceUrls ?? [];
        const citations = citedUrls(item.article.html);
        const citedSourceCount = sources.filter((source) =>
          citations.has(normalizeUrl(source))
        ).length;

        if (textLength < blog.targetLength.min || textLength > blog.targetLength.max) {
          issues.push({
            code: "TARGET_LENGTH",
            severity: "ERROR",
            message: `Article text length ${textLength} is outside ${blog.targetLength.min}-${blog.targetLength.max}`
          });
        }
        if (!item.provenance) {
          issues.push({
            code: "PROVENANCE_MISSING",
            severity: "ERROR",
            message: "Article is missing generation request and source provenance"
          });
        } else if (citedSourceCount !== sources.length) {
          issues.push({
            code: "SOURCE_CITATION_MISSING",
            severity: "ERROR",
            message: `Article cites ${citedSourceCount} of ${sources.length} provenance sources as HTTPS links`
          });
        }
        if (item.article.searchDescription.length > 150) {
          issues.push({
            code: "SEARCH_DESCRIPTION_LENGTH",
            severity: "ERROR",
            message: "Blogger search description must be at most 150 characters"
          });
        }
        const boilerplate = genericBoilerplateMatches(text);
        if (boilerplate.length > 0) {
          issues.push({
            code: "GENERIC_BOILERPLATE",
            severity: "ERROR",
            message: `Article contains generic boilerplate markers: ${boilerplate.join(", ")}`
          });
        }
        const driftDomains = unanchoredDomainSignals(item.article.html, item);
        if (driftDomains.length > 0) {
          issues.push({
            code: "TOPIC_DRIFT",
            severity: "ERROR",
            message: `Article contains unanchored terminology from unrelated domains: ${driftDomains.join(", ")}`
          });
        }
        if (!/<h2\b/i.test(item.article.html)) {
          issues.push({
            code: "H2_MISSING",
            severity: "WARNING",
            message: "Article does not contain an h2 heading"
          });
        }
        if (item.article.labels.length === 0) {
          issues.push({
            code: "LABELS_MISSING",
            severity: "WARNING",
            message: "Article has no labels"
          });
        }
        if (Array.from(item.article.title).length > 100) {
          issues.push({
            code: "TITLE_LONG",
            severity: "WARNING",
            message: "Article title is longer than 100 characters"
          });
        }
        for (const excluded of blog.excludedTopics) {
          if (
            `${item.article.title} ${text}`
              .toLocaleLowerCase("und")
              .includes(excluded.toLocaleLowerCase("und"))
          ) {
            issues.push({
              code: "EXCLUDED_TOPIC",
              severity: "ERROR",
              message: `Article contains excluded topic: ${excluded}`
            });
          }
        }

        let imageBytes: number | null = null;
        if (!item.article.imagePath) {
          issues.push({
            code: "IMAGE_MISSING",
            severity: "ERROR",
            message: "Article is missing imagePath"
          });
        } else {
          try {
            imageBytes = (await this.validateImage(item.article.imagePath)).sizeBytes;
          } catch (error) {
            issues.push({
              code: "IMAGE_INVALID",
              severity: "ERROR",
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }

        return {
          index,
          blogKey: item.blogKey,
          slug: item.article.slug,
          status: issues.some((issue) => issue.severity === "ERROR") ? "FAIL" : "PASS",
          metrics: {
            textLength,
            targetLengthMin: blog.targetLength.min,
            targetLengthMax: blog.targetLength.max,
            sourceCount: sources.length,
            citedSourceCount,
            labelCount: item.article.labels.length,
            imageBytes
          },
          issues
        };
      })
    );
    const errors = items
      .flatMap((item) => item.issues)
      .filter((issue) => issue.severity === "ERROR").length;
    const warnings = items
      .flatMap((item) => item.issues)
      .filter((issue) => issue.severity === "WARNING").length;
    const failed = items.filter((item) => item.status === "FAIL").length;
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: failed === 0 ? "PASS" : "FAIL",
      counts: {
        total: items.length,
        passed: items.length - failed,
        failed,
        errors,
        warnings
      },
      items
    };
  }
}
