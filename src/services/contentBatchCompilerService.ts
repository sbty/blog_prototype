import type { BatchManifest } from "../domain/batch.js";
import {
  BatchImageAttachmentService,
  type AttachedBatchImage
} from "./batchImageAttachmentService.js";
import {
  GeneratedArticleBatchCompilerService,
  type GeneratedArticleBatchCompilerResult
} from "./generatedArticleBatchCompilerService.js";

export interface ContentBatchCompilerResult {
  manifest: BatchManifest;
  requestIds: string[];
  assignments: GeneratedArticleBatchCompilerResult["assignments"];
  images: AttachedBatchImage[];
}

export class ContentBatchCompilerService {
  constructor(
    private readonly generatedBatchCompiler = new GeneratedArticleBatchCompilerService(),
    private readonly imageAttachment = new BatchImageAttachmentService()
  ) {}

  async execute(
    planInput: unknown,
    responsesInput: unknown,
    imagesInput: unknown
  ): Promise<ContentBatchCompilerResult> {
    const generated = this.generatedBatchCompiler.execute(planInput, responsesInput);
    const attached = await this.imageAttachment.execute(generated.manifest, imagesInput);

    return {
      manifest: attached.manifest,
      requestIds: generated.requestIds,
      assignments: generated.assignments,
      images: attached.images
    };
  }
}
