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
import type { SchedulePreparationEvidence } from "./scheduleEvidencePreparationService.js";

export interface ScheduleBatchItemResult {
  index: number;
  jobId: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  evidence?: SchedulePreparationEvidence;
  error?: string;
}

export interface ScheduleBatchExecutionResult {
  batchId: string;
  operation: ScheduleBatchManifest["operation"];
  artifactDir: string;
  reportPath: string;
  executionManifestPath?: string;
  retryManifestPath?: string;
  startedAt: string;
  completedAt: string;
  counts: { total: number; succeeded: number; failed: number; skipped: number };
  items: ScheduleBatchItemResult[];
}

type ApprovalItem = Extract<
  ScheduleBatchManifest,
  { operation: "approve-schedules" }
>["items"][number];
type PreparationItem = Extract<
  ScheduleBatchManifest,
  { operation: "prepare-schedules" }
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
      prepare: (input: PreparationItem) => Promise<SchedulePreparationEvidence>;
      validateExecution: (input: ExecutionItem) => Promise<unknown>;
      execute: (input: ExecutionItem) => Promise<unknown>;
    },
    private readonly logger: Logger
  ) {}

  async run(input: unknown): Promise<ScheduleBatchExecutionResult> {
    const manifest = scheduleBatchManifestSchema.parse(input);
    this.assertOperationEnabled(manifest.operation);
    await assertNotStopped(this.config.DATA_DIR);

    if (manifest.operation === "execute-schedules") {
      await this.validateExecutionBatch(manifest.items);
    }

    const batchId = makeJobId("schedule-batch");
    const artifactDir = await createArtifactDir(this.config.DATA_DIR, batchId);
    const reportPath = path.join(artifactDir, "schedule-batch-result.json");
    const startedAt = new Date().toISOString();
    const results: ScheduleBatchItemResult[] = [];

    for (let index = 0; index < manifest.items.length; index += 1) {
      const item = manifest.items[index];
      try {
        await assertNotStopped(this.config.DATA_DIR);
        const evidence = await this.executeItem(manifest.operation, item);
        results.push({
          index,
          jobId: item.jobId,
          status: "SUCCEEDED",
          ...(evidence ? { evidence } : {})
        });
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

    let executionManifestPath: string | undefined;
    if (manifest.operation === "prepare-schedules") {
      const preparedItems = results.flatMap((item) =>
        item.status === "SUCCEEDED" && item.evidence
          ? [
              {
                jobId: item.jobId,
                confirmation: item.jobId,
                packageSha256: item.evidence.packageSha256,
                auditSha256: item.evidence.auditSha256
              }
            ]
          : []
      );
      if (preparedItems.length > 0) {
        executionManifestPath = path.join(artifactDir, "schedule-execution-batch.json");
        await writeJsonArtifactAtomic(executionManifestPath, {
          operation: "execute-schedules",
          continueOnError: manifest.continueOnError,
          items: preparedItems
        });
      }
    }
    const retryItems = results.flatMap((resultItem) =>
      resultItem.status === "SUCCEEDED" ? [] : [manifest.items[resultItem.index]]
    );
    let retryManifestPath: string | undefined;
    if (retryItems.length > 0) {
      retryManifestPath = path.join(artifactDir, "schedule-batch-retry.json");
      await writeJsonArtifactAtomic(retryManifestPath, {
        operation: manifest.operation,
        continueOnError: manifest.continueOnError,
        items: retryItems
      });
    }
    const result: ScheduleBatchExecutionResult = {
      batchId,
      operation: manifest.operation,
      artifactDir,
      reportPath,
      ...(executionManifestPath ? { executionManifestPath } : {}),
      ...(retryManifestPath ? { retryManifestPath } : {}),
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
      {
        batchId,
        operation: manifest.operation,
        counts: result.counts,
        reportPath,
        retryManifestPath
      },
      "Schedule batch completed"
    );
    return result;
  }

  private async validateExecutionBatch(items: ExecutionItem[]): Promise<void> {
    const failures: string[] = [];
    for (const item of items) {
      await assertNotStopped(this.config.DATA_DIR);
      try {
        await this.executors.validateExecution(item);
      } catch (error) {
        if (error instanceof StopRequestedError) throw error;
        failures.push(`${item.jobId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`Schedule batch execution preflight failed: ${failures.join("; ")}`);
    }
  }

  private async executeItem(
    operation: ScheduleBatchManifest["operation"],
    item: ScheduleBatchItem
  ): Promise<SchedulePreparationEvidence | undefined> {
    if (operation === "approve-schedules") {
      await this.executors.approve(item as ApprovalItem);
      return undefined;
    }
    if (operation === "prepare-schedules") {
      return this.executors.prepare(item as PreparationItem);
    }
    await this.executors.execute(item as ExecutionItem);
    return undefined;
  }

  private assertOperationEnabled(operation: ScheduleBatchManifest["operation"]): void {
    if (operation !== "execute-schedules") {
      if (this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
        throw new Error(
          "Batch schedule approval and preparation require ENABLE_DRAFT_SAVE=false and ENABLE_SCHEDULED_POST=false"
        );
      }
      if (operation === "prepare-schedules" && !this.config.ENABLE_DRY_RUN) {
        throw new Error("Batch schedule preparation requires ENABLE_DRY_RUN=true");
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
