import path from "node:path";
import type { Logger } from "pino";
import type { BlogConfig } from "../config/blogConfig.js";
import type { AppConfig } from "../config/env.js";
import { batchManifestSchema, type BatchManifest } from "../domain/batch.js";
import type { ArticleInput } from "../domain/article.js";
import { assertNotStopped, StopRequestedError } from "../system/stop.js";
import { createArtifactDir, makeJobId, writeJsonArtifactAtomic } from "./artifacts.js";

interface ItemExecutionResult {
  jobId: string;
  artifactDir: string;
}

type ItemExecutor = (input: {
  blog: BlogConfig;
  article: ArticleInput;
}) => Promise<ItemExecutionResult>;

export interface BatchItemResult {
  index: number;
  blogKey: string;
  slug: string;
  title: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  jobId?: string;
  artifactDir?: string;
  error?: string;
}

export interface BatchExecutionResult {
  batchId: string;
  operation: BatchManifest["operation"];
  artifactDir: string;
  reportPath: string;
  startedAt: string;
  completedAt: string;
  counts: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
  items: BatchItemResult[];
}

export class BatchExecutionService {
  constructor(
    private readonly config: AppConfig,
    private readonly executors: {
      dryRun: ItemExecutor;
      saveDraft: ItemExecutor;
      planSchedule: ItemExecutor;
    },
    private readonly logger: Logger
  ) {}

  async execute(input: unknown): Promise<BatchExecutionResult> {
    const manifest = batchManifestSchema.parse(input);
    this.assertOperationEnabled(manifest.operation);
    await assertNotStopped(this.config.DATA_DIR);

    const batchId = makeJobId("batch");
    const artifactDir = await createArtifactDir(this.config.DATA_DIR, batchId);
    const reportPath = path.join(artifactDir, "batch-result.json");
    const startedAt = new Date().toISOString();
    const blogs = new Map(manifest.blogs.map((blog) => [blog.blogKey, blog]));
    const results: BatchItemResult[] = [];

    for (let index = 0; index < manifest.items.length; index += 1) {
      const item = manifest.items[index];
      const blog = blogs.get(item.blogKey)!;
      try {
        await assertNotStopped(this.config.DATA_DIR);
        const executor =
          manifest.operation === "dry-run"
            ? this.executors.dryRun
            : manifest.operation === "save-drafts"
              ? this.executors.saveDraft
              : this.executors.planSchedule;
        const executed = await executor({ blog, article: item.article });
        results.push({
          index,
          blogKey: item.blogKey,
          slug: item.article.slug,
          title: item.article.title,
          status: "SUCCEEDED",
          ...executed
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          index,
          blogKey: item.blogKey,
          slug: item.article.slug,
          title: item.article.title,
          status: "FAILED",
          error: message
        });
        if (error instanceof StopRequestedError || !manifest.continueOnError) {
          const reason =
            error instanceof StopRequestedError
              ? "Skipped because STOP was requested"
              : "Skipped after an earlier item failed";
          for (
            let skippedIndex = index + 1;
            skippedIndex < manifest.items.length;
            skippedIndex += 1
          ) {
            const skipped = manifest.items[skippedIndex];
            results.push({
              index: skippedIndex,
              blogKey: skipped.blogKey,
              slug: skipped.article.slug,
              title: skipped.article.title,
              status: "SKIPPED",
              error: reason
            });
          }
          break;
        }
      }
    }

    const result: BatchExecutionResult = {
      batchId,
      operation: manifest.operation,
      artifactDir,
      reportPath,
      startedAt,
      completedAt: new Date().toISOString(),
      counts: {
        total: results.length,
        succeeded: results.filter((item) => item.status === "SUCCEEDED").length,
        failed: results.filter((item) => item.status === "FAILED").length,
        skipped: results.filter((item) => item.status === "SKIPPED").length
      },
      items: results
    };
    await writeJsonArtifactAtomic(reportPath, result);
    this.logger.info(
      { batchId, operation: manifest.operation, counts: result.counts, reportPath },
      "Batch execution completed"
    );
    return result;
  }

  private assertOperationEnabled(operation: BatchManifest["operation"]): void {
    if (operation === "dry-run") {
      if (
        !this.config.ENABLE_DRY_RUN ||
        this.config.ENABLE_DRAFT_SAVE ||
        this.config.ENABLE_SCHEDULED_POST
      ) {
        throw new Error(
          "Batch dry-run requires ENABLE_DRY_RUN=true and both mutation flags disabled"
        );
      }
      return;
    }
    if (operation === "save-drafts") {
      if (!this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
        throw new Error(
          "Batch draft save requires ENABLE_DRAFT_SAVE=true and ENABLE_SCHEDULED_POST=false"
        );
      }
      return;
    }
    if (this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Batch schedule planning requires ENABLE_DRAFT_SAVE=false and ENABLE_SCHEDULED_POST=false"
      );
    }
  }
}
