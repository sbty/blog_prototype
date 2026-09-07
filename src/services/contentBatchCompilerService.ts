import type { BatchManifest } from "../domain/batch.js";
import {
  BatchImageAttachmentService,
  type AttachedBatchImage
} from "./batchImageAttachmentService.js";
import {
  GeneratedArticleBatchCompilerService,
  type GeneratedArticleBatchCompilerResult
} from "./generatedArticleBatchCompilerService.js";
import {
  BatchSourceAttachmentService,
  type AttachedBatchSources
} from "./batchSourceAttachmentService.js";

export interface ContentBatchCompilerResult {
  manifest: BatchManifest;
  requestIds: string[];
  assignments: GeneratedArticleBatchCompilerResult["assignments"];
  images: AttachedBatchImage[];
  sources: AttachedBatchSources[];
}

export class ContentBatchCompilerService {
  constructor(
    private readonly generatedBatchCompiler = new GeneratedArticleBatchCompilerService(),
    private readonly imageAttachment = new BatchImageAttachmentService(),
    private readonly sourceAttachment = new BatchSourceAttachmentService()
  ) {}

  async execute(
    planInput: unknown,
    responsesInput: unknown,
    imagesInput: unknown,
    sourcesInput: unknown
  ): Promise<ContentBatchCompilerResult> {
    const generated = this.generatedBatchCompiler.execute(planInput, responsesInput);
    const attached = await this.imageAttachment.execute(generated.manifest, imagesInput);
    const cited = this.sourceAttachment.execute(attached.manifest, sourcesInput);

    return {
      manifest: cited.manifest,
      requestIds: generated.requestIds,
      assignments: generated.assignments,
      images: attached.images,
      sources: cited.sources
    };
  }
}
