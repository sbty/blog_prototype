import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/env.js";
import type { JobRecord } from "../domain/job.js";
import { calculateArtifactSha256 } from "../services/scheduleApprovalIntegrity.js";
import { ScheduleEvidencePreparationService } from "../services/scheduleEvidencePreparationService.js";

function fixture(
  flags: { scheduled?: boolean; draft?: boolean; status?: JobRecord["status"] } = {}
) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "blogger-schedule-preparation-"));
  const artifactDir = path.join(dataDir, "jobs", "job-1");
  mkdirSync(artifactDir, { recursive: true });
  const job: JobRecord = {
    id: "job-1",
    blogKey: "blog-1",
    mode: "schedule",
    status: flags.status ?? "APPROVED_FOR_POST",
    payloadJson: "{}",
    artifactDir,
    error: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  };
  const previewText = '{"preview":true}';
  const confirmationText = '{"confirmation":true}';
  const packageText = '{"package":true}';
  const auditText = '{"audit":true}';
  const preview = {
    execute: vi.fn(async () => {
      writeFileSync(path.join(artifactDir, "schedule-browser-preview.json"), previewText);
      return { previewArtifactSha256: calculateArtifactSha256(previewText) };
    })
  };
  const confirm = {
    execute: vi.fn(async () => {
      writeFileSync(path.join(artifactDir, "schedule-preview-confirmation.json"), confirmationText);
      return {};
    })
  };
  const preparePackage = {
    execute: vi.fn(async () => {
      writeFileSync(path.join(artifactDir, "schedule-execution-package.json"), packageText);
      return {};
    })
  };
  const auditPackage = {
    execute: vi.fn(async () => {
      writeFileSync(path.join(artifactDir, "schedule-execution-package-audit.json"), auditText);
      return {};
    })
  };
  const config = loadConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: path.join(dataDir, "app.sqlite"),
    ENABLE_DRAFT_SAVE: String(flags.draft ?? false),
    ENABLE_SCHEDULED_POST: String(flags.scheduled ?? false)
  });
  const jobs = { find: vi.fn((jobId: string) => (jobId === job.id ? job : null)) };
  const service = new ScheduleEvidencePreparationService(config, jobs, {
    preview,
    confirm,
    preparePackage,
    auditPackage
  });
  return {
    dataDir,
    artifactDir,
    service,
    stages: { preview, confirm, preparePackage, auditPackage },
    hashes: {
      previewSha256: calculateArtifactSha256(previewText),
      previewConfirmationSha256: calculateArtifactSha256(confirmationText),
      packageSha256: calculateArtifactSha256(packageText),
      auditSha256: calculateArtifactSha256(auditText)
    }
  };
}

describe("ScheduleEvidencePreparationService", () => {
  it("chains generated hashes through all four non-mutating stages", async () => {
    const { service, stages, hashes } = fixture();
    const result = await service.execute({ jobId: "job-1", confirmation: "job-1" });

    expect(result).toEqual(hashes);
    expect(stages.confirm.execute).toHaveBeenCalledWith({
      jobId: "job-1",
      confirmation: "job-1",
      previewSha256: hashes.previewSha256
    });
    expect(stages.preparePackage.execute).toHaveBeenCalledWith({
      jobId: "job-1",
      confirmation: "job-1",
      previewConfirmationSha256: hashes.previewConfirmationSha256
    });
    expect(stages.auditPackage.execute).toHaveBeenCalledWith({
      jobId: "job-1",
      packageSha256: hashes.packageSha256
    });
  });

  it("resumes a preview-confirmed job from existing package and audit evidence", async () => {
    const { service, stages, artifactDir } = fixture({ status: "PREVIEW_CONFIRMED" });
    const previewArtifact = {
      jobId: "job-1",
      readiness: {
        jobId: "job-1",
        checkedAt: "2026-08-01T00:01:00.000Z",
        planSha256: "a".repeat(64),
        localChecksPassed: true,
        executionEnabled: false,
        executionAuthorized: false,
        bloggerMutationPerformed: false,
        quota: { systemCount: 0, systemLimit: 3, blogCount: 0, blogLimit: 1 }
      },
      dryRun: {
        screenshotPath: "preview.png",
        currentUrl: "https://www.blogger.com/blog/post/edit/1111111111",
        publishButtonVisible: true,
        postSettings: {
          labels: ["test"],
          searchDescription: "description",
          slug: "article",
          applied: true
        },
        schedulePreview: {
          scheduledAt: "2026-08-20T00:00:00.000Z",
          date: "2026/08/20",
          time: "09:00",
          timezone: "Asia/Tokyo"
        },
        networkGuard: {
          blockedMutationRequests: 0,
          blockedRequests: [],
          blockedRequestLogTruncated: false
        }
      },
      bloggerMutationPerformed: false,
      executionAuthorized: false,
      evidence: {
        previewedAt: "2026-08-01T00:02:00.000Z",
        planSha256: "a".repeat(64),
        approvalSha256: "b".repeat(64),
        screenshotSha256: "c".repeat(64)
      }
    };
    const previewText = JSON.stringify(previewArtifact, null, 2);
    const previewSha256 = calculateArtifactSha256(previewText);
    const confirmationText = JSON.stringify(
      {
        artifactType: "schedule-preview-confirmation",
        schemaVersion: 1,
        jobId: "job-1",
        confirmedAt: "2026-08-01T00:03:00.000Z",
        previewSha256,
        confirmationMatched: true,
        executionEnabled: false,
        executionAuthorized: false,
        bloggerMutationPerformed: false
      },
      null,
      2
    );
    const previewConfirmationSha256 = calculateArtifactSha256(confirmationText);
    const packageText = JSON.stringify(
      {
        artifactType: "schedule-execution-package",
        schemaVersion: 1,
        jobId: "job-1",
        preparedAt: "2026-08-01T00:04:00.000Z",
        evidence: {
          planSha256: "a".repeat(64),
          approvalSha256: "b".repeat(64),
          previewSha256,
          previewConfirmationSha256,
          screenshotSha256: "c".repeat(64)
        },
        evidenceChainValid: true,
        executionEnabled: false,
        executionAuthorized: false,
        bloggerMutationPerformed: false,
        requiresExternalExecutionImplementation: true
      },
      null,
      2
    );
    const packageSha256 = calculateArtifactSha256(packageText);
    const auditText = JSON.stringify(
      {
        artifactType: "schedule-execution-package-audit",
        schemaVersion: 1,
        jobId: "job-1",
        auditedAt: "2026-08-01T00:05:00.000Z",
        packageSha256,
        evidenceChainValid: true,
        executionEnabled: false,
        executionAuthorized: false,
        bloggerMutationPerformed: false
      },
      null,
      2
    );
    writeFileSync(path.join(artifactDir, "schedule-browser-preview.json"), previewText);
    writeFileSync(path.join(artifactDir, "schedule-preview-confirmation.json"), confirmationText);
    writeFileSync(path.join(artifactDir, "schedule-execution-package.json"), packageText);
    writeFileSync(path.join(artifactDir, "schedule-execution-package-audit.json"), auditText);

    await expect(service.execute({ jobId: "job-1", confirmation: "job-1" })).resolves.toEqual({
      previewSha256,
      previewConfirmationSha256,
      packageSha256,
      auditSha256: calculateArtifactSha256(auditText)
    });
    expect(stages.preview.execute).not.toHaveBeenCalled();
    expect(stages.confirm.execute).not.toHaveBeenCalled();
    expect(stages.preparePackage.execute).not.toHaveBeenCalled();
    expect(stages.auditPackage.execute).not.toHaveBeenCalled();
  });
  it("stops between stages before consuming newly written evidence", async () => {
    const { dataDir, service, stages } = fixture();
    stages.confirm.execute.mockImplementationOnce(async () => {
      writeFileSync(path.join(dataDir, "STOP"), "stop");
      return {};
    });

    await expect(service.execute({ jobId: "job-1", confirmation: "job-1" })).rejects.toThrow(
      "STOP"
    );
    expect(stages.preparePackage.execute).not.toHaveBeenCalled();
  });

  it("fails closed for unsafe flags, mismatched confirmation, and missing jobs", async () => {
    const unsafe = fixture({ scheduled: true });
    await expect(unsafe.service.execute({ jobId: "job-1", confirmation: "job-1" })).rejects.toThrow(
      "ENABLE_SCHEDULED_POST=false"
    );
    expect(unsafe.stages.preview.execute).not.toHaveBeenCalled();

    const mismatch = fixture();
    await expect(
      mismatch.service.execute({ jobId: "job-1", confirmation: "wrong" })
    ).rejects.toThrow("exactly match");
    expect(mismatch.stages.preview.execute).not.toHaveBeenCalled();

    await expect(
      mismatch.service.execute({ jobId: "missing", confirmation: "missing" })
    ).rejects.toThrow("Schedule job not found");
  });
});
