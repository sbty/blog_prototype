import path from "node:path";
import type { Logger } from "pino";
import type { AppConfig } from "../config/env.js";
import {
  scheduleBatchManifestSchema,
  type ScheduleBatchItem,
  type ScheduleBatchManifest
} from "../domain/scheduleBatch.js";
import { assertNotStopped, StopRequestedError } from "../system/stop.js";
import { createArtifactDir, makeJobId, writeJsonArtifactAtomic } from "./artifacts.js";

export interface ScheduleBatchItemResult {
  index: number;
  jobId: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  error?: string;
}

export interface ScheduleBatchExecutionResult {
  batchId: string;
  operation: ScheduleBatchManifest["operation"];
  artifactDir: string;
  reportPath: string;
  startedAt: string;
  completedAt: string;
  counts: { total: number; succeeded: number; failed: number; skipped: number };
  items: ScheduleBatchItemResult[];
}

type ApprovalItem = Extract<
  ScheduleBatchManifest,
  { operation: "approve-schedules" }
>["items"][number];
type ExecutionItem = Extract<
  ScheduleBatchManifest,
  { operation: "execute-schedules" }
>["items"][number];

export class ScheduleBatchExecutionService {
  constructor(
    private readonly config: AppConfig,
    private readonly executors: {
      approve: (input: ApprovalItem) => Promise<unknown>;
      execute: (input: ExecutionItem) => Promise<unknown>;
    },
    private readonly logger: Logger
  ) {}

  async run(input: unknown): Promise<ScheduleBatchExecutionResult> {
    const manifest = scheduleBatchManifestSchema.parse(input);
    this.assertOperationEnabled(manifest.operation);
    await assertNotStopped(this.config.DATA_DIR);

    const batchId = makeJobId("schedule-batch");
    const artifactDir = await createArtifactDir(this.config.DATA_DIR, batchId);
    const reportPath = path.join(artifactDir, "schedule-batch-result.json");
    const startedAt = new Date().toISOString();
    const results: ScheduleBatchItemResult[] = [];

    for (let index = 0; index < manifest.items.length; index += 1) {
      const item = manifest.items[index];
      try {
        await assertNotStopped(this.config.DATA_DIR);
        await this.executeItem(manifest.operation, item);
        results.push({ index, jobId: item.jobId, status: "SUCCEEDED" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ index, jobId: item.jobId, status: "FAILED", error: message });
        if (error instanceof StopRequestedError || !manifest.continueOnError) {
          const reason =
            error instanceof StopRequestedError
              ? "Skipped because STOP was requested"
              : "Skipped after an earlier item failed";
          for (let skipped = index + 1; skipped < manifest.items.length; skipped += 1) {
            results.push({
              index: skipped,
              jobId: manifest.items[skipped].jobId,
              status: "SKIPPED",
              error: reason
            });
          }
          break;
        }
      }
    }

    const result: ScheduleBatchExecutionResult = {
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
      "Schedule batch completed"
    );
    return result;
  }

  private executeItem(
    operation: ScheduleBatchManifest["operation"],
    item: ScheduleBatchItem
  ): Promise<unknown> {
    return operation === "approve-schedules"
      ? this.executors.approve(item as ApprovalItem)
      : this.executors.execute(item as ExecutionItem);
  }

  private assertOperationEnabled(operation: ScheduleBatchManifest["operation"]): void {
    if (operation === "approve-schedules") {
      if (this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
        throw new Error(
          "Batch schedule approval requires ENABLE_DRAFT_SAVE=false and ENABLE_SCHEDULED_POST=false"
        );
      }
      return;
    }
    if (!this.config.ENABLE_SCHEDULED_POST || this.config.ENABLE_DRAFT_SAVE) {
      throw new Error(
        "Batch schedule execution requires ENABLE_SCHEDULED_POST=true and ENABLE_DRAFT_SAVE=false"
      );
    }
  }
}
