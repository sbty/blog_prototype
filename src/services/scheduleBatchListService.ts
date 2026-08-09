import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/env.js";
import type {
  ScheduleBatchInspectionResult,
  ScheduleBatchInspectionStatus
} from "./scheduleBatchInspectionService.js";

const maxBatches = 1000;

interface BatchInspector {
  execute(input: { batchId: string }): Promise<ScheduleBatchInspectionResult>;
}

export type ScheduleBatchListState = ScheduleBatchInspectionStatus | "INVALID";

export interface ScheduleBatchListItem {
  batchId: string;
  state: ScheduleBatchListState;
  operation?: ScheduleBatchInspectionResult["operation"];
  completedAt?: string;
  counts?: ScheduleBatchInspectionResult["counts"];
  reportPath?: string;
  executionManifestPath?: string;
  retryManifestPath?: string;
  error?: string;
}

export interface ScheduleBatchListResult {
  generatedAt: string;
  total: number;
  batches: ScheduleBatchListItem[];
}

export class ScheduleBatchListService {
  constructor(
    private readonly config: AppConfig,
    private readonly inspector: BatchInspector
  ) {}

  async execute(): Promise<ScheduleBatchListResult> {
    const batchIds = await this.findBatchIds();
    const batches: ScheduleBatchListItem[] = [];
    for (const batchId of batchIds) {
      try {
        const inspection = await this.inspector.execute({ batchId });
        batches.push({
          batchId,
          state: inspection.status,
          operation: inspection.operation,
          completedAt: inspection.completedAt,
          counts: inspection.counts,
          reportPath: inspection.reportPath,
          ...(inspection.executionManifestPath
            ? { executionManifestPath: inspection.executionManifestPath }
            : {}),
          ...(inspection.retryManifestPath
            ? { retryManifestPath: inspection.retryManifestPath }
            : {})
        });
      } catch (error) {
        batches.push({
          batchId,
          state: "INVALID",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    batches.sort((left, right) => {
      if (left.completedAt && right.completedAt) {
        return right.completedAt.localeCompare(left.completedAt);
      }
      if (left.completedAt) return -1;
      if (right.completedAt) return 1;
      return right.batchId.localeCompare(left.batchId);
    });
    return { generatedAt: new Date().toISOString(), total: batches.length, batches };
  }

  private async findBatchIds(): Promise<string[]> {
    let dataRoot: string;
    let jobsRoot: string;
    try {
      dataRoot = await realpath(this.config.DATA_DIR);
      jobsRoot = await realpath(path.join(dataRoot, "jobs"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const relative = path.relative(dataRoot, jobsRoot);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("DATA_DIR/jobs must resolve inside DATA_DIR");
    }
    const entries = await readdir(jobsRoot, { withFileTypes: true });
    const batchIds = entries
      .filter(
        (entry) => entry.isDirectory() && /^schedule-batch-[A-Za-z0-9._-]{1,185}$/.test(entry.name)
      )
      .map((entry) => entry.name);
    if (batchIds.length > maxBatches) {
      throw new Error(`Too many schedule batch directories to inspect: ${batchIds.length}`);
    }
    return batchIds;
  }
}
