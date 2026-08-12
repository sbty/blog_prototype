import { z } from "zod";
import { blogConfigSchema } from "../config/blogConfig.js";
import { articleInputSchema } from "./article.js";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Identifier must use lowercase ASCII words and hyphens");

const sourceUrlSchema = z
  .string()
  .url()
  .max(4096)
  .superRefine((value, context) => {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "Source URL must use HTTPS" });
    }
    if (url.username || url.password) {
      context.addIssue({ code: "custom", message: "Source URL must not contain credentials" });
    }
  });

const uniqueStrings = (values: string[]): boolean =>
  new Set(values.map((value) => value.normalize("NFKC").trim().toLocaleLowerCase("und"))).size ===
  values.length;

export const articleGenerationPlanSchema = z
  .object({
    targetOperation: z.enum(["dry-run", "save-drafts", "plan-schedules"]),
    continueOnError: z.boolean().default(true),
    blogs: z.array(blogConfigSchema).min(1).max(50),
    requests: z
      .array(
        z
          .object({
            requestId: identifierSchema,
            blogKey: z.string().trim().min(1).max(200),
            slug: identifierSchema,
            topic: z.string().trim().min(1).max(500),
            searchIntent: z.string().trim().min(1).max(1000),
            routingTopics: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
            requiredPoints: z.array(z.string().trim().min(1).max(1000)).min(1).max(50),
            sourceUrls: z
              .array(sourceUrlSchema)
              .min(1)
              .max(30)
              .refine(uniqueStrings, "Source URLs must be unique"),
            scheduledAt: z.string().datetime({ offset: true }).optional()
          })
          .strict()
      )
      .min(1)
      .max(500)
  })
  .strict()
  .superRefine((plan, context) => {
    const blogKeys = new Set<string>();
    plan.blogs.forEach((blog, index) => {
      if (blogKeys.has(blog.blogKey)) {
        context.addIssue({
          code: "custom",
          path: ["blogs", index, "blogKey"],
          message: `Duplicate blogKey: ${blog.blogKey}`
        });
      }
      blogKeys.add(blog.blogKey);
    });

    const requestIds = new Set<string>();
    const slugs = new Set<string>();
    plan.requests.forEach((request, index) => {
      if (!blogKeys.has(request.blogKey)) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "blogKey"],
          message: `Unknown blogKey: ${request.blogKey}`
        });
      }
      if (requestIds.has(request.requestId)) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "requestId"],
          message: `Duplicate requestId: ${request.requestId}`
        });
      }
      requestIds.add(request.requestId);
      if (slugs.has(request.slug)) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "slug"],
          message: `Duplicate requested slug: ${request.slug}`
        });
      }
      slugs.add(request.slug);
      if (plan.targetOperation === "plan-schedules" && !request.scheduledAt) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "scheduledAt"],
          message: "Scheduled generation requests require scheduledAt"
        });
      }
    });
  });

export const generatedArticleResponsesSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z
      .array(
        z
          .object({
            requestId: identifierSchema,
            article: articleInputSchema,
            sourceUrlsUsed: z
              .array(sourceUrlSchema)
              .min(1)
              .max(30)
              .refine(uniqueStrings, "Used source URLs must be unique")
          })
          .strict()
      )
      .min(1)
      .max(500)
  })
  .strict()
  .superRefine((responses, context) => {
    const requestIds = new Set<string>();
    responses.items.forEach((item, index) => {
      if (requestIds.has(item.requestId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "requestId"],
          message: `Duplicate generated requestId: ${item.requestId}`
        });
      }
      requestIds.add(item.requestId);
    });
  });

export type ArticleGenerationPlan = z.infer<typeof articleGenerationPlanSchema>;
export type GeneratedArticleResponses = z.infer<typeof generatedArticleResponsesSchema>;
