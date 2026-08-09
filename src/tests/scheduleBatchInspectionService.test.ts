import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/env.js";
import { ScheduleBatchInspectionService } from "../services/scheduleBatchInspectionService.js";

const sha = (character: string) => character.repeat(64);

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function fixture() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "blogger-schedule-batch-inspection-"));
  const batchId = "schedule-batch-test";
  const batchDir = path.join(dataDir, "jobs", batchId);
  mkdirSync(batchDir, { recursive: true });
  const reportPath = path.join(batchDir, "schedule-batch-result.json");
  const executionManifestPath = path.join(batchDir, "schedule-execution-batch.json");
  const retryManifestPath = path.join(batchDir, "schedule-batch-retry.json");
  const evidence = {
    previewSha256: sha("1"),
    previewConfirmationSha256: sha("2"),
    packageSha256: sha("3"),
    auditSha256: sha("4")
  };
  const report = {
    batchId,
    operation: "prepare-schedules",
    continueOnError: true,
    artifactDir: batchDir,
    reportPath,
    executionManifestPath,
    retryManifestPath,
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T00:01:00.000Z",
    counts: { total: 2, succeeded: 1, failed: 1, skipped: 0 },
    items: [
      { index: 0, jobId: "job-1", status: "SUCCEEDED", evidence },
      { index: 1, jobId: "job-2", status: "FAILED", error: "preview failed" }
    ]
  };
  writeJson(reportPath, report);
  writeJson(executionManifestPath, {
    operation: "execute-schedules",
    continueOnError: true,
    items: [
      {
        jobId: "job-1",
        confirmation: "job-1",
        packageSha256: evidence.packageSha256,
        auditSha256: evidence.auditSha256
      }
    ]
  });
  writeJson(retryManifestPath, {
    operation: "prepare-schedules",
    continueOnError: true,
    items: [{ jobId: "job-2", confirmation: "job-2" }]
  });
  const config = loadConfig({ DATA_DIR: dataDir, DATABASE_PATH: path.join(dataDir, "app.sqlite") });
  return {
    service: new ScheduleBatchInspectionService(config),
    batchId,
    batchDir,
    reportPath,
    executionManifestPath,
    retryManifestPath,
    report,
    evidence
  };
}

describe("ScheduleBatchInspectionService", () => {
  it("validates prepared execution and retry manifests", async () => {
    const { service, batchId } = fixture();
    const result = await service.execute({ batchId });

    expect(result).toMatchObject({
      batchId,
      operation: "prepare-schedules",
      status: "RETRY_AVAILABLE",
      reportValid: true,
      executionManifest: { present: true, valid: true },
      retryManifest: { present: true, valid: true },
      retryManifestPath: expect.stringContaining("schedule-batch-retry.json"),
      counts: { total: 2, succeeded: 1, failed: 1, skipped: 0 }
    });
  });

  it("classifies a successful approval batch as completed", async () => {
    const { service, batchId, reportPath, report } = fixture();
    writeJson(reportPath, {
      ...report,
      operation: "approve-schedules",
      continueOnError: undefined,
      executionManifestPath: undefined,
      retryManifestPath: undefined,
      counts: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
      items: [{ index: 0, jobId: "job-1", status: "SUCCEEDED" }]
    });

    const result = await service.execute({ batchId });
    expect(result.status).toBe("COMPLETED");
    expect(result.executionManifest).toEqual({ present: false, valid: true });
    expect(result.retryManifest).toEqual({ present: false, valid: true });
  });

  it("reports tampered companion manifests as needing attention", async () => {
    const { service, batchId, executionManifestPath, retryManifestPath } = fixture();
    writeJson(executionManifestPath, {
      operation: "execute-schedules",
      items: [
        {
          jobId: "job-1",
          confirmation: "job-1",
          packageSha256: sha("f"),
          auditSha256: sha("4")
        }
      ]
    });
    writeJson(retryManifestPath, {
      operation: "prepare-schedules",
      continueOnError: false,
      items: [{ jobId: "other-job", confirmation: "other-job" }]
    });

    const result = await service.execute({ batchId });
    expect(result.status).toBe("ATTENTION");
    expect(result.executionManifest.valid).toBe(false);
    expect(result.retryManifest.valid).toBe(false);
  });

  it("detects missing companion manifests recorded by the report", async () => {
    const { service, batchId, reportPath, report } = fixture();
    writeJson(reportPath, {
      ...report,
      executionManifestPath: undefined,
      retryManifestPath: undefined
    });

    const result = await service.execute({ batchId });
    expect(result.status).toBe("ATTENTION");
    expect(result.executionManifest).toMatchObject({ present: false, valid: false });
    expect(result.retryManifest).toMatchObject({ present: false, valid: false });
  });

  it("rejects unsafe IDs and internally inconsistent reports", async () => {
    const { service, batchId, reportPath, report } = fixture();
    await expect(service.execute({ batchId: "../outside" })).rejects.toThrow(
      "Schedule batch ID is not safe"
    );

    writeJson(reportPath, {
      ...report,
      counts: { total: 99, succeeded: 1, failed: 1, skipped: 0 }
    });
    await expect(service.execute({ batchId })).rejects.toThrow("Schedule batch counts mismatch");
  });
});
