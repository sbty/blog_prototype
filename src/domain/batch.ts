import { z } from "zod";
import { blogConfigSchema } from "../config/blogConfig.js";
import { articleInputSchema } from "./article.js";

export const batchManifestSchema = z
  .object({
    operation: z.enum(["dry-run", "save-drafts", "plan-schedules"]),
    continueOnError: z.boolean().default(true),
    blogs: z.array(blogConfigSchema).min(1).max(50),
    items: z
      .array(
        z
          .object({
            blogKey: z.string().trim().min(1).max(200),
            article: articleInputSchema
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
      if (manifest.operation === "dry-run" && !blog.blogger.postEditorUrl) {
        context.addIssue({
          code: "custom",
          path: ["blogs", index, "blogger", "postEditorUrl"],
          message: "Dry-run batches require an existing dedicated draft postEditorUrl"
        });
      }
    });

    const assignments = new Set<string>();
    manifest.items.forEach((item, index) => {
      if (!blogKeys.has(item.blogKey)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "blogKey"],
          message: `Unknown blogKey: ${item.blogKey}`
        });
      }
      const assignment = `${item.blogKey}\0${item.article.slug}`;
      if (assignments.has(assignment)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "article", "slug"],
          message: `Duplicate article assignment: ${item.blogKey}/${item.article.slug}`
        });
      }
      assignments.add(assignment);
      if (manifest.operation === "plan-schedules" && !item.article.scheduledAt) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "article", "scheduledAt"],
          message: "Scheduled batch items require article.scheduledAt"
        });
      }
    });
  });

export type BatchManifest = z.infer<typeof batchManifestSchema>;
