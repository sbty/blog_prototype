import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/env.js";
import type { JobRecord } from "../domain/job.js";
import { calculateArtifactSha256 } from "../services/scheduleApprovalIntegrity.js";
import { ScheduleCampaignInspectionService } from "../services/scheduleCampaignInspectionService.js";

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function fixture() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "blogger-campaign-inspection-"));
  const campaignId = "schedule-campaign-test";
  const campaignDir = path.join(dataDir, "jobs", campaignId);
  const jobDir = path.join(dataDir, "jobs", "job-1");
  mkdirSync(campaignDir, { recursive: true });
  mkdirSync(jobDir, { recursive: true });
  const packageText = '{"package":true}';
  const auditText = '{"audit":true}';
  writeFileSync(path.join(jobDir, "schedule-execution-package.json"), packageText);
  writeFileSync(path.join(jobDir, "schedule-execution-package-audit.json"), auditText);
  const evidence = {
    previewSha256: "1".repeat(64),
    previewConfirmationSha256: "2".repeat(64),
    packageSha256: calculateArtifactSha256(packageText),
    auditSha256: calculateArtifactSha256(auditText)
  };
  const executionManifestPath = path.join(campaignDir, "schedule-execution-batch.json");
  const retryManifestPath = path.join(campaignDir, "schedule-campaign-retry.json");
  const reportPath = path.join(campaignDir, "schedule-campaign-result.json");
  const report = {
    campaignId,
    operation: "prepare-campaign",
    artifactDir: campaignDir,
    reportPath,
    executionManifestPath,
    retryManifestPath,
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T00:10:00.000Z",
    counts: { total: 2, succeeded: 1, failed: 1, skipped: 0 },
    items: [
      {
        index: 0,
        blogKey: "blog-1",
        slug: "one",
        title: "Article one",
        status: "SUCCEEDED",
        jobId: "job-1",
        evidence
      },
      {
        index: 1,
        blogKey: "blog-2",
        slug: "two",
        title: "Article two",
        status: "FAILED",
        failedPhase: "PLAN",
        error: "plan failed"
      }
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
    operation: "prepare-campaign",
    continueOnError: true,
    blogs: [
      {
        blogKey: "blog-2",
        displayName: "Blog 2",
        adminUrl: "https://www.blogger.com/blog/posts/2222222222",
        primaryTheme: "testing"
      }
    ],
    items: [
      {
        blogKey: "blog-2",
        article: {
          title: "Article two",
          html: "<p>two</p>",
          labels: ["test"],
          searchDescription: "Description two",
          slug: "two",
          scheduledAt: "2026-08-20T00:00:00.000Z"
        }
      }
    ]
  });
  const job: JobRecord = {
    id: "job-1",
    blogKey: "blog-1",
    mode: "schedule",
    status: "PREVIEW_CONFIRMED",
    payloadJson: "{}",
    artifactDir: jobDir,
    error: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  };
  const config = loadConfig({ DATA_DIR: dataDir, DATABASE_PATH: path.join(dataDir, "app.sqlite") });
  const jobs = { find: (jobId: string) => (jobId === job.id ? job : null) };
  const service = new ScheduleCampaignInspectionService(config, jobs);
  return {
    service,
    campaignId,
    campaignDir,
    jobDir,
    reportPath,
    executionManifestPath,
    report,
    evidence,
    job
  };
}

describe("ScheduleCampaignInspectionService", () => {
  it("classifies executable and retryable campaign items", async () => {
    const { service, campaignId } = fixture();
    const result = await service.execute({ campaignId });

    expect(result.reportValid).toBe(true);
    expect(result.executionManifest).toEqual({ present: true, valid: true });
    expect(result.retryManifest).toEqual({ present: true, valid: true });
    expect(result.items.map((item) => item.action)).toEqual([
      "READY_TO_EXECUTE",
      "RETRY_AVAILABLE"
    ]);
    expect(result.counts.READY_TO_EXECUTE).toBe(1);
    expect(result.counts.RETRY_AVAILABLE).toBe(1);
  });

  it("recognizes a valid completed execution artifact", async () => {
    const { service, campaignId, jobDir } = fixture();
    writeJson(path.join(jobDir, "schedule-execution-result.json"), {
      screenshotPath: "schedule-confirmed.png",
      currentUrl: "https://www.blogger.com/blog/posts/1111111111",
      savedAt: "2026-08-01T00:11:00.000Z",
      scheduledAt: "2026-08-20T00:00:00.000Z"
    });

    const result = await service.execute({ campaignId });
    expect(result.items[0].action).toBe("EXECUTED");
    expect(result.counts.EXECUTED).toBe(1);
  });

  it("reports changed evidence and a mismatched execution manifest", async () => {
    const { service, campaignId, jobDir, executionManifestPath, evidence } = fixture();
    writeFileSync(path.join(jobDir, "schedule-execution-package.json"), "changed");
    writeJson(executionManifestPath, {
      operation: "execute-schedules",
      items: [
        {
          jobId: "job-1",
          confirmation: "job-1",
          packageSha256: "f".repeat(64),
          auditSha256: evidence.auditSha256
        }
      ]
    });

    const result = await service.execute({ campaignId });
    expect(result.executionManifest.valid).toBe(false);
    expect(result.items[0].action).toBe("EVIDENCE_INVALID");
  });

  it("does not inspect job artifacts outside DATA_DIR/jobs", async () => {
    const { service, campaignId, job } = fixture();
    job.artifactDir = os.tmpdir();

    const result = await service.execute({ campaignId });
    expect(result.items[0]).toMatchObject({
      action: "JOB_STATE_INVALID",
      detail: "Job artifact directory is outside DATA_DIR/jobs"
    });
  });
  it("validates a recorded campaign preflight artifact", async () => {
    const { service, campaignId, campaignDir, reportPath, report } = fixture();
    const preflightPath = path.join(campaignDir, "schedule-campaign-preflight.json");
    writeJson(preflightPath, {
      checkedAt: "2026-08-01T00:00:00.000Z",
      passed: true,
      counts: { blogs: 2, items: 2, images: 0 },
      issues: [],
      warnings: []
    });
    writeJson(reportPath, { ...report, preflightPath });
    await expect(service.execute({ campaignId })).resolves.toMatchObject({ reportValid: true });

    writeJson(preflightPath, {
      checkedAt: "2026-08-01T00:00:00.000Z",
      passed: false,
      counts: { blogs: 2, items: 2, images: 0 },
      issues: [{ code: "BAD", path: "items.0", message: "failed" }],
      warnings: []
    });
    await expect(service.execute({ campaignId })).rejects.toThrow();
  });
  it("rejects unsafe IDs and internally inconsistent reports", async () => {
    const { service, campaignId, reportPath, report } = fixture();
    await expect(service.execute({ campaignId: "../outside" })).rejects.toThrow(
      "Campaign ID is not safe"
    );

    writeJson(reportPath, {
      ...report,
      counts: { total: 99, succeeded: 1, failed: 1, skipped: 0 }
    });
    await expect(service.execute({ campaignId })).rejects.toThrow("Campaign counts mismatch");
  });
});
