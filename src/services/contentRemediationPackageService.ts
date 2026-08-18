import { z } from "zod";
import { batchManifestSchema } from "../domain/batch.js";
import { ContentAuditRetryService } from "./contentAuditRetryService.js";
import { contentBatchAuditResultSchema } from "./contentBatchAuditService.js";

const safeSourceUrlSchema = z
  .string()
  .url()
  .max(4096)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Remediation source URL must be credential-free HTTPS");

export const contentRemediationPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    requests: z
      .array(
        z
          .object({
            remediationId: z
              .string()
              .regex(/^content-remediation-\d{4}$/)
              .max(100),
            sourceIndex: z.number().int().nonnegative(),
            blogKey: z.string().trim().min(1).max(200),
            editorialProfile: z
              .object({
                displayName: z.string().trim().min(1).max(500),
                language: z.string().trim().min(1).max(100),
                targetCountry: z.string().trim().min(1).max(100),
                primaryTheme: z.string().trim().min(1).max(2000),
                targetAudience: z.array(z.string().trim().min(1).max(1000)).max(100),
                topicClusters: z.array(z.string().trim().min(1).max(1000)).max(100),
                excludedTopics: z.array(z.string().trim().min(1).max(1000)).max(100),
                targetLength: z
                  .object({ min: z.number().int().positive(), max: z.number().int().positive() })
                  .strict()
              })
              .strict(),
            currentArticle: z
              .object({
                title: z.string().trim().min(1).max(500),
                html: z.string().trim().min(1).max(500_000),
                labels: z.array(z.string().trim().min(1).max(200)).max(50),
                searchDescription: z.string().max(500),
                slug: z.string().trim().min(1).max(100)
              })
              .strict(),
            provenance: z
              .object({
                sourceUrls: z.array(safeSourceUrlSchema).max(30),
                requiresSourceResearch: z.boolean()
              })
              .strict(),
            audit: z
              .object({
                metrics: contentBatchAuditResultSchema.shape.items.element.shape.metrics,
                issues: contentBatchAuditResultSchema.shape.items.element.shape.issues
              })
              .strict(),
            correctionRules: z.tuple([
              z.literal("resolve every listed audit issue"),
              z.literal("preserve the slug exactly"),
              z.literal("preserve the article topic and search intent"),
              z.literal("cite every provided source URL as an HTTPS link"),
              z.literal("do not invent source URLs or unsupported claims"),
              z.literal("return a complete replacement article")
            ]),
            outputContract: z
              .object({
                requiredFields: z.tuple([
                  z.literal("title"),
                  z.literal("html"),
                  z.literal("labels"),
                  z.literal("searchDescription"),
                  z.literal("slug")
                ]),
                responseFields: z.tuple([
                  z.literal("remediationId"),
                  z.literal("article"),
                  z.literal("sourceUrlsUsed")
                ]),
                preserveImagePathOutOfBand: z.literal(true),
                preserveScheduledAtOutOfBand: z.literal(true)
              })
              .strict()
          })
          .strict()
      )
      .min(1)
      .max(500)
  })
  .strict()
  .superRefine((remediationPackage, context) => {
    const ids = new Set<string>();
    remediationPackage.requests.forEach((request, index) => {
      if (ids.has(request.remediationId)) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "remediationId"],
          message: `Duplicate remediationId: ${request.remediationId}`
        });
      }
      ids.add(request.remediationId);
      if (
        request.provenance.requiresSourceResearch !==
        (request.provenance.sourceUrls.length === 0)
      ) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "provenance"],
          message: "Source research flag must match source URL availability"
        });
      }
    });
  });

export type ContentRemediationPackage = z.infer<typeof contentRemediationPackageSchema>;

export class ContentRemediationPackageService {
  execute(batchInput: unknown, auditInput: unknown): ContentRemediationPackage {
    const batch = batchManifestSchema.parse(batchInput);
    const audit = contentBatchAuditResultSchema.parse(auditInput);
    const retry = new ContentAuditRetryService().execute(batch, audit);
    const blogs = new Map(batch.blogs.map((blog) => [blog.blogKey, blog]));

    const output = {
      schemaVersion: 1 as const,
      requests: retry.failedAssignments.map((failed) => {
        const item = batch.items[failed.index];
        const audited = audit.items[failed.index];
        const blog = blogs.get(item.blogKey)!;
        const sourceUrls = item.provenance?.sourceUrls ?? [];
        return {
          remediationId: `content-remediation-${String(failed.index + 1).padStart(4, "0")}`,
          sourceIndex: failed.index,
          blogKey: item.blogKey,
          editorialProfile: {
            displayName: blog.displayName,
            language: blog.language,
            targetCountry: blog.targetCountry,
            primaryTheme: blog.primaryTheme,
            targetAudience: blog.targetAudience,
            topicClusters: blog.topicClusters,
            excludedTopics: blog.excludedTopics,
            targetLength: blog.targetLength
          },
          currentArticle: {
            title: item.article.title,
            html: item.article.html,
            labels: item.article.labels,
            searchDescription: item.article.searchDescription,
            slug: item.article.slug
          },
          provenance: {
            sourceUrls,
            requiresSourceResearch: sourceUrls.length === 0
          },
          audit: {
            metrics: audited.metrics,
            issues: audited.issues
          },
          correctionRules: [
            "resolve every listed audit issue",
            "preserve the slug exactly",
            "preserve the article topic and search intent",
            "cite every provided source URL as an HTTPS link",
            "do not invent source URLs or unsupported claims",
            "return a complete replacement article"
          ] as const,
          outputContract: {
            requiredFields: ["title", "html", "labels", "searchDescription", "slug"] as const,
            responseFields: ["remediationId", "article", "sourceUrlsUsed"] as const,
            preserveImagePathOutOfBand: true as const,
            preserveScheduledAtOutOfBand: true as const
          }
        };
      })
    };
    return contentRemediationPackageSchema.parse(output);
  }
}
