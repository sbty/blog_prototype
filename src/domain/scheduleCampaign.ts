import { z } from "zod";
import { blogConfigSchema } from "../config/blogConfig.js";
import { articleInputSchema } from "./article.js";

const jobIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/);

export const scheduleCampaignManifestSchema = z
  .object({
    operation: z.literal("prepare-campaign"),
    continueOnError: z.boolean().default(true),
    blogs: z.array(blogConfigSchema).min(1).max(50),
    items: z
      .array(
        z
          .object({
            blogKey: z.string().trim().min(1).max(200),
            article: articleInputSchema,
            resumeJobId: jobIdSchema.optional()
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

    const assignments = new Set<string>();
    const resumeJobIds = new Set<string>();
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
      if (item.resumeJobId) {
        if (resumeJobIds.has(item.resumeJobId)) {
          context.addIssue({
            code: "custom",
            path: ["items", index, "resumeJobId"],
            message: `Duplicate resume job: ${item.resumeJobId}`
          });
        }
        resumeJobIds.add(item.resumeJobId);
      }
      if (!item.article.scheduledAt) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "article", "scheduledAt"],
          message: "Campaign articles require article.scheduledAt"
        });
      }
    });
  });

export type ScheduleCampaignManifest = z.infer<typeof scheduleCampaignManifestSchema>;
