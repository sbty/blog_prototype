import type { BatchManifest } from "../domain/batch.js";
import {
  ArticleQueueRoutingService,
  type ArticleQueueAssignment
} from "./articleQueueRoutingService.js";
import { GeneratedArticleImportService } from "./generatedArticleImportService.js";

export interface GeneratedArticleBatchCompilerResult {
  manifest: BatchManifest;
  assignments: ArticleQueueAssignment[];
  requestIds: string[];
}

export class GeneratedArticleBatchCompilerService {
  execute(planInput: unknown, responsesInput: unknown): GeneratedArticleBatchCompilerResult {
    const queue = new GeneratedArticleImportService().execute(planInput, responsesInput);
    const routed = new ArticleQueueRoutingService().execute(queue);

    return {
      manifest: routed.manifest,
      assignments: routed.assignments,
      requestIds: queue.items.map((item) => item.provenance!.generationRequestId)
    };
  }
}
