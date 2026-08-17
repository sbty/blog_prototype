import { z } from "zod";
import { blogConfigSchema } from "../config/blogConfig.js";
import { articleInputSchema } from "./article.js";

function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

const routingSchema = z
  .object({
    blogKey: z.string().trim().min(1).max(200).optional(),
    topics: z.array(z.string().trim().min(1).max(500)).max(50).default([])
  })
  .strict()
  .refine((routing) => routing.blogKey || routing.topics.length > 0, {
    message: "Queue routing requires blogKey or at least one topic"
  });

export const articleProvenanceSchema = z
  .object({
    generationRequestId: z.string().trim().min(1).max(100),
    sourceUrls: z
      .array(
        z.string().url().max(4096).refine(isSafeHttpsUrl, {
          message: "Provenance source URL must use HTTPS"
        })
      )
      .min(1)
      .max(30)
  })
  .strict();

export const articleQueueManifestSchema = z
  .object({
    targetOperation: z.enum(["dry-run", "save-drafts", "plan-schedules"]),
    continueOnError: z.boolean().default(true),
    blogs: z.array(blogConfigSchema).min(1).max(50),
    items: z
      .array(
        z
          .object({
            article: articleInputSchema,
            routing: routingSchema,
            provenance: articleProvenanceSchema.optional()
          })
          .strict()
      )
      .min(1)
      .max(500)
  })
  .strict()
  .superRefine((manifest, context) => {
    const blogKeys = new Set<string>();
    manifest.blogs.forEach((blog, index) => {
      if (blogKeys.has(blog.blogKey)) {
        context.addIssue({
          code: "custom",
          path: ["blogs", index, "blogKey"],
          message: `Duplicate blogKey: ${blog.blogKey}`
        });
      }
      blogKeys.add(blog.blogKey);
    });

    const slugs = new Set<string>();
    manifest.items.forEach((item, index) => {
      if (item.routing.blogKey && !blogKeys.has(item.routing.blogKey)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "routing", "blogKey"],
          message: `Unknown blogKey: ${item.routing.blogKey}`
        });
      }
      if (slugs.has(item.article.slug)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "article", "slug"],
          message: `Duplicate queue article slug: ${item.article.slug}`
        });
      }
      slugs.add(item.article.slug);
    });
  });

export type ArticleQueueManifest = z.infer<typeof articleQueueManifestSchema>;
export type ArticleProvenance = z.infer<typeof articleProvenanceSchema>;
