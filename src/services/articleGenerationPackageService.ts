import {
  articleGenerationPlanSchema,
  type ArticleGenerationPlan
} from "../domain/articleGeneration.js";

export interface ArticleGenerationPackage {
  schemaVersion: 1;
  requests: Array<{
    requestId: string;
    editorialProfile: {
      blogKey: string;
      displayName: string;
      language: string;
      targetCountry: string;
      primaryTheme: string;
      targetAudience: string[];
      topicClusters: string[];
      excludedTopics: string[];
      targetLength: { min: number; max: number };
    };
    brief: {
      topic: string;
      searchIntent: string;
      requiredPoints: string[];
      sourceUrls: string[];
    };
    outputContract: {
      slug: string;
      scheduledAt?: string;
      requiredFields: readonly ["title", "html", "labels", "searchDescription", "slug"];
      htmlRestrictions: readonly [
        "script",
        "object",
        "embed",
        "form",
        "event handlers",
        "javascript URLs"
      ];
      responseFields: readonly ["requestId", "article", "sourceUrlsUsed"];
    };
  }>;
}

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
