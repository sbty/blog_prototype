import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/env.js";
import { ScheduleBatchExecutionService } from "../services/scheduleBatchExecutionService.js";
import { StopRequestedError } from "../system/stop.js";

const sha = (character: string) => character.repeat(64);

function fixture(flags: { scheduled?: boolean; draft?: boolean } = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "blogger-schedule-batch-"));
  const config = loadConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: path.join(dataDir, "app.sqlite"),
    ENABLE_DRAFT_SAVE: String(flags.draft ?? false),
    ENABLE_SCHEDULED_POST: String(flags.scheduled ?? false)
  });
  const approve = vi.fn(async (input: { jobId: string; confirmation: string }) => ({
    approved: input.confirmation === input.jobId
  }));
  const execute = vi.fn(
    async (input: {
      jobId: string;
      confirmation: string;
      packageSha256: string;
      auditSha256: string;
    }) => ({ scheduled: input.packageSha256.length === 64 })
  );
  const service = new ScheduleBatchExecutionService(
    config,
    { approve, execute },
    pino({ enabled: false })
  );
  return { dataDir, service, approve, execute };
}

function approval(jobId: string) {
  return { jobId, confirmation: jobId };
}

function execution(jobId: string) {
  return {
    jobId,
    confirmation: jobId,
    packageSha256: sha("a"),
    auditSha256: sha("b")
  };
}

describe("ScheduleBatchExecutionService", () => {
  it("approves multiple jobs and writes a durable report", async () => {
    const { service, approve } = fixture();
    const result = await service.run({
      operation: "approve-schedules",
      items: [approval("job-1"), approval("job-2")]
    });

    expect(approve.mock.calls.map(([input]) => input.jobId)).toEqual(["job-1", "job-2"]);
    expect(result.counts).toEqual({ total: 2, succeeded: 2, failed: 0, skipped: 0 });
    expect(JSON.parse(readFileSync(result.reportPath, "utf8"))).toMatchObject({
      batchId: result.batchId,
      operation: "approve-schedules",
      counts: result.counts
    });
  });

  it("executes multiple jobs with their individual evidence hashes", async () => {
    const { service, execute } = fixture({ scheduled: true });
    const result = await service.run({
      operation: "execute-schedules",
      items: [execution("job-1"), execution("job-2")]
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).toEqual(execution("job-1"));
    expect(result.items.map((item) => item.status)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
  });

  it("validates all confirmations, hashes, and duplicate jobs before execution", async () => {
    const { service, approve } = fixture();
    await expect(
      service.run({
        operation: "approve-schedules",
        items: [approval("job-1"), { jobId: "job-1", confirmation: "wrong" }]
      })
    ).rejects.toThrow();
    expect(approve).not.toHaveBeenCalled();

    const executionFixture = fixture({ scheduled: true });
    await expect(
      executionFixture.service.run({
        operation: "execute-schedules",
        items: [{ ...execution("job-2"), auditSha256: "invalid" }]
      })
    ).rejects.toThrow("lowercase SHA-256");
    expect(executionFixture.execute).not.toHaveBeenCalled();
  });

  it("continues after ordinary failures and skips the rest after fail-fast or STOP", async () => {
    const continuing = fixture();
    continuing.approve.mockRejectedValueOnce(new Error("failed"));
    const continued = await continuing.service.run({
      operation: "approve-schedules",
      items: [approval("job-1"), approval("job-2")]
    });
    expect(continued.items.map((item) => item.status)).toEqual(["FAILED", "SUCCEEDED"]);

    const failFast = fixture();
    failFast.approve.mockRejectedValueOnce(new Error("failed"));
    const stoppedEarly = await failFast.service.run({
      operation: "approve-schedules",
      continueOnError: false,
      items: [approval("job-1"), approval("job-2")]
    });
    expect(stoppedEarly.items.map((item) => item.status)).toEqual(["FAILED", "SKIPPED"]);

    const stopped = fixture();
    stopped.approve.mockRejectedValueOnce(
      new StopRequestedError(path.join(stopped.dataDir, "STOP"))
    );
    const stopResult = await stopped.service.run({
      operation: "approve-schedules",
      items: [approval("job-1"), approval("job-2")]
    });
    expect(stopResult.items.map((item) => item.status)).toEqual(["FAILED", "SKIPPED"]);
    expect(stopResult.items[1].error).toContain("STOP");
  });

  it("requires mutually exclusive safe flags for each operation", async () => {
    const approvalUnsafe = fixture({ scheduled: true });
    await expect(
      approvalUnsafe.service.run({
        operation: "approve-schedules",
        items: [approval("job-1")]
      })
    ).rejects.toThrow("ENABLE_SCHEDULED_POST=false");

    const executionUnsafe = fixture();
    await expect(
      executionUnsafe.service.run({
        operation: "execute-schedules",
        items: [execution("job-1")]
      })
    ).rejects.toThrow("ENABLE_SCHEDULED_POST=true");
  });
});
