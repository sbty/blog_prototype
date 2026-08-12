import {
  articleGenerationPlanSchema,
  generatedArticleResponsesSchema
} from "../domain/articleGeneration.js";
import { articleQueueManifestSchema, type ArticleQueueManifest } from "../domain/articleQueue.js";

function normalizedUrlSet(urls: string[]): Set<string> {
  return new Set(urls.map((url) => new URL(url).href));
}

function assertSameSources(requestId: string, planned: string[], used: string[]): void {
  const plannedSet = normalizedUrlSet(planned);
  const usedSet = normalizedUrlSet(used);
  if (
    plannedSet.size !== usedSet.size ||
    [...plannedSet].some((sourceUrl) => !usedSet.has(sourceUrl))
  ) {
    throw new Error(`Generated response ${requestId} must attest to every planned source URL`);
  }
}

export class GeneratedArticleImportService {
  execute(planInput: unknown, responsesInput: unknown): ArticleQueueManifest {
    const plan = articleGenerationPlanSchema.parse(planInput);
    const responses = generatedArticleResponsesSchema.parse(responsesInput);
    const responsesById = new Map(responses.items.map((item) => [item.requestId, item]));

    const unknownIds = responses.items
      .map((item) => item.requestId)
      .filter((requestId) => !plan.requests.some((request) => request.requestId === requestId));
    if (unknownIds.length > 0) {
      throw new Error(`Generated responses contain unknown requestIds: ${unknownIds.join(", ")}`);
    }

    const items = plan.requests.map((request) => {
      const response = responsesById.get(request.requestId);
      if (!response) throw new Error(`Missing generated response for ${request.requestId}`);
      if (response.article.slug !== request.slug) {
        throw new Error(`Generated response ${request.requestId} changed the requested slug`);
      }
      if (response.article.scheduledAt !== request.scheduledAt) {
        throw new Error(`Generated response ${request.requestId} changed scheduledAt`);
      }
      assertSameSources(request.requestId, request.sourceUrls, response.sourceUrlsUsed);
      return {
        article: response.article,
        routing: { blogKey: request.blogKey, topics: request.routingTopics },
        provenance: {
          generationRequestId: request.requestId,
          sourceUrls: response.sourceUrlsUsed
        }
      };
    });

    return articleQueueManifestSchema.parse({
      targetOperation: plan.targetOperation,
      continueOnError: plan.continueOnError,
      blogs: plan.blogs,
      items
    });
  }
}
