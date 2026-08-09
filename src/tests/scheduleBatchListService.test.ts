import { mkdtempSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/env.js";
import {
  ScheduleBatchListService,
  type ScheduleBatchListState
} from "../services/scheduleBatchListService.js";
import type {
  ScheduleBatchInspectionResult,
  ScheduleBatchInspectionStatus
} from "../services/scheduleBatchInspectionService.js";

function inspection(
  batchId: string,
  completedAt: string,
  status: ScheduleBatchInspectionStatus
): ScheduleBatchInspectionResult {
  const artifactDir = path.join("C:/data/jobs", batchId);
  return {
    batchId,
    operation: "execute-schedules",
    inspectedAt: "2026-08-09T00:00:00.000Z",
    completedAt,
    artifactDir,
    reportPath: path.join(artifactDir, "schedule-batch-result.json"),
    ...(status === "RETRY_AVAILABLE"
      ? { retryManifestPath: path.join(artifactDir, "schedule-batch-retry.json") }
      : {}),
    status,
    reportValid: true,
    executionManifest: { present: false, valid: true },
    retryManifest: { present: status === "RETRY_AVAILABLE", valid: status !== "ATTENTION" },
    counts:
      status === "RETRY_AVAILABLE"
        ? { total: 2, succeeded: 1, failed: 1, skipped: 0 }
        : { total: 1, succeeded: 1, failed: 0, skipped: 0 },
    items: []
  };
}

function fixture() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "blogger-schedule-batch-list-"));
  const jobsDir = path.join(dataDir, "jobs");
  mkdirSync(jobsDir);
  for (const name of [
    "schedule-batch-old",
    "schedule-batch-new",
    "schedule-batch-bad",
    "schedule-campaign-ignore",
    "job-ignore"
  ]) {
    mkdirSync(path.join(jobsDir, name));
  }
  const results = new Map<string, ScheduleBatchInspectionResult>([
    [
      "schedule-batch-old",
      inspection("schedule-batch-old", "2026-08-01T00:00:00.000Z", "COMPLETED")
    ],
    [
      "schedule-batch-new",
      inspection("schedule-batch-new", "2026-08-02T00:00:00.000Z", "RETRY_AVAILABLE")
    ]
  ]);
  const inspector = {
    execute: vi.fn(async ({ batchId }: { batchId: string }) => {
      const result = results.get(batchId);
      if (!result) throw new Error("invalid schedule batch report");
      return result;
    })
  };
  const config = loadConfig({ DATA_DIR: dataDir, DATABASE_PATH: path.join(dataDir, "app.sqlite") });
  return { dataDir, inspector, service: new ScheduleBatchListService(config, inspector) };
}

describe("ScheduleBatchListService", () => {
  it("lists schedule batches newest first with actionable paths", async () => {
    const { service, inspector } = fixture();
    const result = await service.execute();

    expect(result.total).toBe(3);
    expect(result.batches.map((batch) => [batch.batchId, batch.state])).toEqual([
      ["schedule-batch-new", "RETRY_AVAILABLE"],
      ["schedule-batch-old", "COMPLETED"],
      ["schedule-batch-bad", "INVALID"]
    ] satisfies Array<[string, ScheduleBatchListState]>);
    expect(result.batches[0].retryManifestPath).toContain("schedule-batch-retry.json");
    expect(inspector.execute).toHaveBeenCalledTimes(3);
    expect(inspector.execute).not.toHaveBeenCalledWith({ batchId: "schedule-campaign-ignore" });
    expect(inspector.execute).not.toHaveBeenCalledWith({ batchId: "job-ignore" });
  });

  it("preserves attention state from strict inspection", async () => {
    const { dataDir } = fixture();
    const inspector = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(
          inspection("schedule-batch-old", "2026-08-01T00:00:00.000Z", "ATTENTION")
        )
        .mockResolvedValueOnce(
          inspection("schedule-batch-new", "2026-08-02T00:00:00.000Z", "COMPLETED")
        )
        .mockRejectedValueOnce(new Error("invalid"))
    };
    const config = loadConfig({
      DATA_DIR: dataDir,
      DATABASE_PATH: path.join(dataDir, "app.sqlite")
    });
    const result = await new ScheduleBatchListService(config, inspector).execute();
    expect(result.batches.map((batch) => batch.state).sort()).toEqual([
      "ATTENTION",
      "COMPLETED",
      "INVALID"
    ]);
  });

  it("returns an empty list before the jobs directory exists", async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "blogger-empty-schedule-batch-list-"));
    const config = loadConfig({
      DATA_DIR: dataDir,
      DATABASE_PATH: path.join(dataDir, "app.sqlite")
    });
    const inspector = { execute: vi.fn() };
    const result = await new ScheduleBatchListService(config, inspector).execute();
    expect(result).toMatchObject({ total: 0, batches: [] });
    expect(inspector.execute).not.toHaveBeenCalled();
  });
});
