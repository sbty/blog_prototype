import { validateImageFile, type ValidatedImageFile } from "../browser/imageFile.js";
import { batchManifestSchema } from "../domain/batch.js";

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
