import { validateImageFile, type ValidatedImageFile } from "../browser/imageFile.js";
import type { AppConfig } from "../config/env.js";
import { batchImageAssignmentsSchema } from "../domain/batchImages.js";
import { batchSourceAssignmentsSchema } from "../domain/batchSources.js";
import { ArticleGenerationPackageService } from "./articleGenerationPackageService.js";
import type { BatchExecutionService } from "./batchExecutionService.js";
import { ContentBatchCompilerService } from "./contentBatchCompilerService.js";
import { assertDraftSaveAuthorized } from "./draftSaveAuthorization.js";
import {
  OpenAIArticleGenerationService,
  type OpenAIGenerationEstimate,
  type OpenAIGenerationUsage
} from "./openAIArticleGenerationService.js";

type PackageService = Pick<ArticleGenerationPackageService, "execute">;
type ArticleGenerator = Pick<OpenAIArticleGenerationService, "estimate" | "execute">;
type ContentCompiler = Pick<ContentBatchCompilerService, "execute">;
type BatchExecutor = Pick<BatchExecutionService, "execute">;
type ImageValidator = (imagePath: string) => Promise<ValidatedImageFile>;

export type VerifiedDraftPipelineArtifact =
  | "generation-preflight"
  | "generated-responses"
  | "generation-usage"
  | "content-batch"
  | "pipeline-summary";

export interface VerifiedDraftPipelineArtifactWriter {
  write(name: VerifiedDraftPipelineArtifact, value: unknown): Promise<void>;
}

export interface VerifiedDraftPipelineSummary {
  schemaVersion: 1;
  status: "PASS" | "FAIL";
  requestId: string;
  blogKey: string;
  operation: "save-drafts";
  generation: {
    responseId: string | null;
    estimate: OpenAIGenerationEstimate;
    usage: OpenAIGenerationUsage | null;
  };
  execution: {
    batchId: string;
    artifactDir: string;
    reportPath: string;
    counts: { total: number; succeeded: number; failed: number; skipped: number };
    contentAudit?: { reportPath: string; status: "PASS" | "FAIL"; counts: unknown };
    item: {
      status: "SUCCEEDED" | "FAILED" | "SKIPPED";
      jobId: string | null;
      artifactDir: string | null;
      error: string | null;
    } | null;
  };
}

export interface VerifiedDraftPipelineDependencies {
  batchExecutor: BatchExecutor;
  packageService?: PackageService;
  articleGenerator?: ArticleGenerator;
  contentCompiler?: ContentCompiler;
  artifactWriter?: VerifiedDraftPipelineArtifactWriter;
  validateImage?: ImageValidator;
}

function sameUrls(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const normalized = new Set(left.map((url) => new URL(url).href));
  return right.every((url) => normalized.has(new URL(url).href));
}

export class VerifiedDraftPipelineService {
  private readonly packageService: PackageService;
  private readonly articleGenerator: ArticleGenerator;
  private readonly contentCompiler: ContentCompiler;
  private readonly artifactWriter: VerifiedDraftPipelineArtifactWriter;
  private readonly validateImage: ImageValidator;

  constructor(
    private readonly config: AppConfig,
    private readonly dependencies: VerifiedDraftPipelineDependencies
  ) {
    this.packageService = dependencies.packageService ?? new ArticleGenerationPackageService();
    this.articleGenerator =
      dependencies.articleGenerator ?? new OpenAIArticleGenerationService(config);
    this.contentCompiler = dependencies.contentCompiler ?? new ContentBatchCompilerService();
    this.artifactWriter = dependencies.artifactWriter ?? { write: async () => undefined };
    this.validateImage = dependencies.validateImage ?? validateImageFile;
  }

  async execute(input: {
    plan: unknown;
    images: unknown;
    sources: unknown;
    confirmedMaximumCostCents: number;
    confirmedDraftSaveRequestId: string;
  }): Promise<VerifiedDraftPipelineSummary> {
    const prepared = this.packageService.execute(input.plan);
    if (prepared.plan.targetOperation !== "save-drafts") {
      throw new Error("Verified draft pipeline requires targetOperation=save-drafts");
    }
    if (prepared.plan.blogs.length !== 1 || prepared.plan.requests.length !== 1) {
      throw new Error("Verified draft pipeline requires exactly one blog and one request");
    }
    const blog = prepared.plan.blogs[0];
    const request = prepared.plan.requests[0];
    if (request.blogKey !== blog.blogKey) {
      throw new Error("Verified draft pipeline request must target its only configured blog");
    }
    if (blog.blogger.postEditorUrl) {
      throw new Error("Verified draft pipeline only creates a new draft");
    }
    if (this.config.ENABLE_EXISTING_DRAFT_UPDATE) {
      throw new Error("Verified draft pipeline requires ENABLE_EXISTING_DRAFT_UPDATE=false");
    }
    if (
      !this.config.ENABLE_DRAFT_SAVE ||
      this.config.ENABLE_DRY_RUN ||
      this.config.ENABLE_SCHEDULED_POST
    ) {
      throw new Error(
        "Verified draft pipeline requires only ENABLE_DRAFT_SAVE=true among Blogger operation flags"
      );
    }
    if (input.confirmedDraftSaveRequestId !== request.requestId) {
      throw new Error(`Draft-save confirmation must exactly match ${request.requestId}`);
    }
    assertDraftSaveAuthorized(this.config, [blog]);

    const images = batchImageAssignmentsSchema.parse(input.images);
    const sources = batchSourceAssignmentsSchema.parse(input.sources);
    if (
      images.items.length !== 1 ||
      images.items[0].blogKey !== blog.blogKey ||
      images.items[0].slug !== request.slug
    ) {
      throw new Error("Image assignment must exactly match the confirmed draft target");
    }
    if (
      sources.items.length !== 1 ||
      sources.items[0].blogKey !== blog.blogKey ||
      sources.items[0].slug !== request.slug ||
      sources.items[0].generationRequestId !== request.requestId ||
      !sameUrls(
        request.sourceUrls,
        sources.items[0].sources.map((source) => source.url)
      )
    ) {
      throw new Error("Source assignment must exactly match the confirmed generation request");
    }
    await this.validateImage(images.items[0].imagePath);

    const preflight = this.articleGenerator.estimate(prepared.package);
    if (input.confirmedMaximumCostCents !== preflight.estimate.maximumCostCents) {
      throw new Error(
        `Cost confirmation must exactly match ${preflight.estimate.maximumCostCents} cents`
      );
    }
    await this.artifactWriter.write("generation-preflight", {
      schemaVersion: 1,
      requestId: request.requestId,
      blogKey: blog.blogKey,
      package: prepared.package,
      estimate: preflight.estimate
    });

    const generated = await this.articleGenerator.execute(
      prepared.package,
      input.confirmedMaximumCostCents
    );
    await this.artifactWriter.write("generated-responses", generated.responses);
    await this.artifactWriter.write("generation-usage", {
      schemaVersion: 1,
      responseId: generated.responseId,
      estimate: generated.estimate,
      usage: generated.usage
    });

    const compiled = await this.contentCompiler.execute(
      prepared.plan,
      generated.responses,
      images,
      sources
    );
    await this.artifactWriter.write("content-batch", compiled.manifest);
    const execution = await this.dependencies.batchExecutor.execute(compiled.manifest);
    const item = execution.items[0];
    const status =
      execution.counts.total === 1 &&
      execution.counts.succeeded === 1 &&
      execution.counts.failed === 0 &&
      execution.counts.skipped === 0
        ? "PASS"
        : "FAIL";
    const summary: VerifiedDraftPipelineSummary = {
      schemaVersion: 1,
      status,
      requestId: request.requestId,
      blogKey: blog.blogKey,
      operation: "save-drafts",
      generation: {
        responseId: generated.responseId,
        estimate: generated.estimate,
        usage: generated.usage
      },
      execution: {
        batchId: execution.batchId,
        artifactDir: execution.artifactDir,
        reportPath: execution.reportPath,
        counts: execution.counts,
        ...(execution.contentAudit ? { contentAudit: execution.contentAudit } : {}),
        item: item
          ? {
              status: item.status,
              jobId: item.jobId ?? null,
              artifactDir: item.artifactDir ?? null,
              error: item.error ?? null
            }
          : null
      }
    };
    await this.artifactWriter.write("pipeline-summary", summary);
    return summary;
  }
}
