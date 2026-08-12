import {
  articleGenerationPlanSchema,
  type ArticleGenerationPlan
} from "../domain/articleGeneration.js";
import { z } from "zod";

export const articleGenerationPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    requests: z
      .array(
        z
          .object({
            requestId: z.string().trim().min(1).max(100),
            editorialProfile: z
              .object({
                blogKey: z.string().trim().min(1).max(200),
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
            brief: z
              .object({
                topic: z.string().trim().min(1).max(500),
                searchIntent: z.string().trim().min(1).max(1000),
                requiredPoints: z.array(z.string().trim().min(1).max(1000)).min(1).max(50),
                sourceUrls: z
                  .array(
                    z
                      .string()
                      .url()
                      .max(4096)
                      .refine((value) => {
                        const url = new URL(value);
                        return url.protocol === "https:" && !url.username && !url.password;
                      }, "Generation source URL must use HTTPS and contain no credentials")
                  )
                  .min(1)
                  .max(30)
              })
              .strict(),
            outputContract: z
              .object({
                slug: z.string().trim().min(1).max(100),
                scheduledAt: z.string().datetime({ offset: true }).optional(),
                requiredFields: z.tuple([
                  z.literal("title"),
                  z.literal("html"),
                  z.literal("labels"),
                  z.literal("searchDescription"),
                  z.literal("slug")
                ]),
                htmlRestrictions: z.tuple([
                  z.literal("script"),
                  z.literal("object"),
                  z.literal("embed"),
                  z.literal("form"),
                  z.literal("event handlers"),
                  z.literal("javascript URLs")
                ]),
                responseFields: z.tuple([
                  z.literal("requestId"),
                  z.literal("article"),
                  z.literal("sourceUrlsUsed")
                ])
              })
              .strict()
          })
          .strict()
      )
      .min(1)
      .max(500)
  })
  .strict()
  .superRefine((generationPackage, context) => {
    const requestIds = new Set<string>();
    const slugs = new Set<string>();
    generationPackage.requests.forEach((request, index) => {
      if (requestIds.has(request.requestId)) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "requestId"],
          message: `Duplicate generation package requestId: ${request.requestId}`
        });
      }
      requestIds.add(request.requestId);
      if (slugs.has(request.outputContract.slug)) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "outputContract", "slug"],
          message: `Duplicate generation package slug: ${request.outputContract.slug}`
        });
      }
      slugs.add(request.outputContract.slug);
      if (request.editorialProfile.targetLength.min > request.editorialProfile.targetLength.max) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "editorialProfile", "targetLength"],
          message: "Generation package targetLength.min must not exceed max"
        });
      }
    });
  });

export type ArticleGenerationPackage = z.infer<typeof articleGenerationPackageSchema>;

export class ArticleGenerationPackageService {
  execute(input: unknown): { plan: ArticleGenerationPlan; package: ArticleGenerationPackage } {
    const plan = articleGenerationPlanSchema.parse(input);
    return {
      plan,
      package: {
        schemaVersion: 1,
        requests: plan.requests.map((request) => {
          const blog = plan.blogs.find((candidate) => candidate.blogKey === request.blogKey);
          if (!blog) throw new Error(`Unknown blogKey: ${request.blogKey}`);
          return {
            requestId: request.requestId,
            editorialProfile: {
              blogKey: blog.blogKey,
              displayName: blog.displayName,
              language: blog.language,
              targetCountry: blog.targetCountry,
              primaryTheme: blog.primaryTheme,
              targetAudience: blog.targetAudience,
              topicClusters: blog.topicClusters,
              excludedTopics: blog.excludedTopics,
              targetLength: blog.targetLength
            },
            brief: {
              topic: request.topic,
              searchIntent: request.searchIntent,
              requiredPoints: request.requiredPoints,
              sourceUrls: request.sourceUrls
            },
            outputContract: {
              slug: request.slug,
              ...(request.scheduledAt ? { scheduledAt: request.scheduledAt } : {}),
              requiredFields: ["title", "html", "labels", "searchDescription", "slug"],
              htmlRestrictions: [
                "script",
                "object",
                "embed",
                "form",
                "event handlers",
                "javascript URLs"
              ],
              responseFields: ["requestId", "article", "sourceUrlsUsed"]
            }
          };
        })
      }
    };
  }
}
