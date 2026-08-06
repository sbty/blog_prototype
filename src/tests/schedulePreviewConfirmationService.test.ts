import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/env.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { migrate, openDatabase } from "../repositories/database.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { calculateArtifactSha256 } from "../services/scheduleApprovalIntegrity.js";
import { SchedulePreviewConfirmationService } from "../services/schedulePreviewConfirmationService.js";
import { ScheduleExecutionPackageService } from "../services/scheduleExecutionPackageService.js";
import { ScheduleExecutionPackageAuditService } from "../services/scheduleExecutionPackageAuditService.js";

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "preview-confirm-"));
  const db = openDatabase(path.join(dir, "app.sqlite"));
  migrate(db);
  const blogs = new BlogRepository(db);
  const jobs = new JobRepository(db);
  blogs.upsert({
    blogKey: "blog-1",
    displayName: "Test Blog",
    adminUrl: "https://www.blogger.com/blog/posts/123",
    primaryTheme: "international affairs",
    language: "ja",
    targetCountry: "JP",
    targetAudience: [],
    topicClusters: [],
    excludedTopics: [],
    contentPolicy: {
      evergreenRatio: 0.55,
      durableExplainerRatio: 0.25,
      seasonalRatio: 0.1,
      newsRatio: 0.1
    },
    targetLength: { min: 3000, max: 5000 },
    dailyPostLimit: 1,
    blogger: { selectorsPath: "./config/blogger-selectors.json" }
  });
  const jobId = "schedule-preview-confirm";
  const artifactDir = path.join(dir, "jobs", jobId);
  const screenshotPath = path.join(artifactDir, "screenshots", "dry-run.png");
  mkdirSync(path.dirname(screenshotPath), { recursive: true });
  jobs.create({ id: jobId, blogKey: "blog-1", mode: "schedule", payload: {}, artifactDir });
  jobs.updateStatus(jobId, "RUNNING", "started");
  jobs.updateStatus(jobId, "READY_FOR_POST", "ready");
  jobs.updateStatus(jobId, "APPROVED_FOR_POST", "approved");
  const planBytes = Buffer.from(
    JSON.stringify({
      scheduledAt: "2026-08-02T00:00:00.000Z",
      date: "2026/08/02",
      time: "09:00",
      timezone: "Asia/Tokyo",
      mode: "local-plan",
      bloggerMutationPerformed: false,
      quota: { systemCount: 1, systemLimit: 3, blogCount: 0, blogLimit: 1 }
    })
  );
  const approvalBytes = Buffer.from(
    JSON.stringify({
      jobId,
      approvedAt: "2026-07-31T00:00:00.000Z",
      confirmationMatched: true,
      bloggerMutationPerformed: false,
      planSha256: calculateArtifactSha256(planBytes)
    })
  );
  const screenshotBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(path.join(artifactDir, "schedule-plan.json"), planBytes);
  writeFileSync(path.join(artifactDir, "schedule-approval.json"), approvalBytes);
  writeFileSync(screenshotPath, screenshotBytes);
  const preview = {
    jobId,
    readiness: {
      jobId,
      checkedAt: "2026-07-31T00:00:00.000Z",
      planSha256: calculateArtifactSha256(planBytes),
      localChecksPassed: true,
      executionEnabled: false,
      executionAuthorized: false,
      bloggerMutationPerformed: false,
      quota: { systemCount: 1, systemLimit: 3, blogCount: 1, blogLimit: 1 }
    },
    dryRun: {
      screenshotPath,
      currentUrl: "https://www.blogger.com/blog/post/edit/123/456",
      publishButtonVisible: true,
      postSettings: {
        labels: [],
        searchDescription: "description",
        slug: "preview",
        applied: true
      },
      schedulePreview: {
        scheduledAt: "2026-08-02T00:00:00.000Z",
        date: "2026/08/02",
        time: "09:00",
        timezone: "Asia/Tokyo"
      },
      networkGuard: {
        blockedMutationRequests: 1,
        blockedRequests: [{ method: "POST", url: "https://www.blogger.com/api/save" }],
        blockedRequestLogTruncated: false
      }
    },
    bloggerMutationPerformed: false,
    executionAuthorized: false,
    evidence: {
      previewedAt: "2026-07-31T00:00:00.000Z",
      planSha256: calculateArtifactSha256(planBytes),
      approvalSha256: calculateArtifactSha256(approvalBytes),
      screenshotSha256: calculateArtifactSha256(screenshotBytes)
    }
  };
  const previewBytes = Buffer.from(JSON.stringify(preview, null, 2));
  writeFileSync(path.join(artifactDir, "schedule-browser-preview.json"), previewBytes);
  return {
    dir,
    artifactDir,
    screenshotPath,
    jobId,
    jobs,
    previewSha256: calculateArtifactSha256(previewBytes),
    config: loadConfig({ DATA_DIR: dir, DATABASE_PATH: path.join(dir, "app.sqlite") })
  };
}

describe("SchedulePreviewConfirmationService", () => {
  it("confirms the exact intact browser preview without enabling execution", async () => {
    const { config, jobs, jobId, artifactDir, previewSha256 } = fixture();
    const service = new SchedulePreviewConfirmationService(
      config,
      jobs,
      pino({ enabled: false }),
      () => new Date("2026-07-31T01:00:00.000Z")
    );
    const result = await service.execute({
      jobId,
      confirmation: jobId,
      previewSha256
    });
    expect(result.artifactType).toBe("schedule-preview-confirmation");
    expect(result.schemaVersion).toBe(1);
    expect(result.executionEnabled).toBe(false);
    expect(result.executionAuthorized).toBe(false);
    expect(result.bloggerMutationPerformed).toBe(false);
    expect(jobs.find(jobId)?.status).toBe("PREVIEW_CONFIRMED");
    expect(
      JSON.parse(
        readFileSync(path.join(artifactDir, "schedule-preview-confirmation.json"), "utf8")
      )
    ).toEqual(result);
  });

  it("rejects a preview SHA-256 that was not explicitly supplied correctly", async () => {
    const { config, jobs, jobId } = fixture();
    const service = new SchedulePreviewConfirmationService(
      config,
      jobs,
      pino({ enabled: false })
    );
    await expect(
      service.execute({ jobId, confirmation: jobId, previewSha256: "0".repeat(64) })
    ).rejects.toThrow("does not match confirmation");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });

  it("rechecks STOP immediately before recording confirmation", async () => {
    const { dir, config, jobs, jobId, artifactDir, previewSha256 } = fixture();
    const service = new SchedulePreviewConfirmationService(
      config,
      jobs,
      pino({ enabled: false }),
      () => {
        writeFileSync(path.join(dir, "STOP"), "");
        return new Date("2026-07-31T01:00:00.000Z");
      }
    );

    await expect(
      service.execute({ jobId, confirmation: jobId, previewSha256 })
    ).rejects.toThrow("STOP");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
    expect(existsSync(path.join(artifactDir, "schedule-preview-confirmation.json"))).toBe(false);
  });
  it("rejects coordinated changes that remove the original approval condition", async () => {
    const { config, jobs, jobId, artifactDir } = fixture();
    const planBytes = readFileSync(path.join(artifactDir, "schedule-plan.json"));
    const approvalPath = path.join(artifactDir, "schedule-approval.json");
    const invalidApprovalBytes = Buffer.from(
      JSON.stringify({
        jobId,
        approvedAt: "2026-07-31T00:00:00.000Z",
        confirmationMatched: false,
        bloggerMutationPerformed: false,
        planSha256: calculateArtifactSha256(planBytes)
      })
    );
    writeFileSync(approvalPath, invalidApprovalBytes);
    const previewPath = path.join(artifactDir, "schedule-browser-preview.json");
    const preview = JSON.parse(readFileSync(previewPath, "utf8"));
    preview.evidence.approvalSha256 = calculateArtifactSha256(invalidApprovalBytes);
    const changedPreviewBytes = Buffer.from(JSON.stringify(preview, null, 2));
    writeFileSync(previewPath, changedPreviewBytes);

    const service = new SchedulePreviewConfirmationService(
      config,
      jobs,
      pino({ enabled: false })
    );
    await expect(
      service.execute({
        jobId,
        confirmation: jobId,
        previewSha256: calculateArtifactSha256(changedPreviewBytes)
      })
    ).rejects.toThrow("approval artifact is invalid");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });
  it("rejects an approval artifact containing fields outside its contract", async () => {
    const { config, jobs, jobId, artifactDir } = fixture();
    const approvalPath = path.join(artifactDir, "schedule-approval.json");
    const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
    const changedApprovalBytes = Buffer.from(
      JSON.stringify({ ...approval, executionEnabled: true })
    );
    writeFileSync(approvalPath, changedApprovalBytes);
    const previewPath = path.join(artifactDir, "schedule-browser-preview.json");
    const preview = JSON.parse(readFileSync(previewPath, "utf8"));
    preview.evidence.approvalSha256 = calculateArtifactSha256(changedApprovalBytes);
    const changedPreviewBytes = Buffer.from(JSON.stringify(preview, null, 2));
    writeFileSync(previewPath, changedPreviewBytes);
    const service = new SchedulePreviewConfirmationService(
      config,
      jobs,
      pino({ enabled: false })
    );

    await expect(
      service.execute({
        jobId,
        confirmation: jobId,
        previewSha256: calculateArtifactSha256(changedPreviewBytes)
      })
    ).rejects.toThrow("approval artifact is invalid");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });
  it("rejects a malformed preview artifact before confirming it", async () => {
    const { config, jobs, jobId, artifactDir } = fixture();
    const previewPath = path.join(artifactDir, "schedule-browser-preview.json");
    const preview = JSON.parse(readFileSync(previewPath, "utf8"));
    delete preview.readiness.executionEnabled;
    const malformedBytes = Buffer.from(JSON.stringify(preview, null, 2));
    writeFileSync(previewPath, malformedBytes);
    const service = new SchedulePreviewConfirmationService(
      config,
      jobs,
      pino({ enabled: false })
    );

    await expect(
      service.execute({
        jobId,
        confirmation: jobId,
        previewSha256: calculateArtifactSha256(malformedBytes)
      })
    ).rejects.toThrow("missing or invalid");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });
  it("rejects readiness evidence belonging to another job", async () => {
    const { config, jobs, jobId, artifactDir } = fixture();
    const previewPath = path.join(artifactDir, "schedule-browser-preview.json");
    const preview = JSON.parse(readFileSync(previewPath, "utf8"));
    preview.readiness.jobId = "different-job";
    const changedBytes = Buffer.from(JSON.stringify(preview, null, 2));
    writeFileSync(previewPath, changedBytes);
    const service = new SchedulePreviewConfirmationService(
      config,
      jobs,
      pino({ enabled: false })
    );

    await expect(
      service.execute({
        jobId,
        confirmation: jobId,
        previewSha256: calculateArtifactSha256(changedBytes)
      })
    ).rejects.toThrow("not a valid non-executing preview");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });
  it("rejects readiness quota limits that differ from the approved plan", async () => {
    const { config, jobs, jobId, artifactDir } = fixture();
    const previewPath = path.join(artifactDir, "schedule-browser-preview.json");
    const preview = JSON.parse(readFileSync(previewPath, "utf8"));
    preview.readiness.quota.systemLimit += 1;
    const changedBytes = Buffer.from(JSON.stringify(preview, null, 2));
    writeFileSync(previewPath, changedBytes);

    await expect(
      new SchedulePreviewConfirmationService(
        config,
        jobs,
        pino({ enabled: false }),
        () => new Date("2026-07-31T01:00:00.000Z")
      ).execute({
        jobId,
        confirmation: jobId,
        previewSha256: calculateArtifactSha256(changedBytes)
      })
    ).rejects.toThrow("quota policy does not match");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });
  it("rejects a browser schedule value that differs from the approved plan", async () => {
    const { config, jobs, jobId, artifactDir } = fixture();
    const previewPath = path.join(artifactDir, "schedule-browser-preview.json");
    const preview = JSON.parse(readFileSync(previewPath, "utf8"));
    preview.dryRun.schedulePreview.time = "09:01";
    const changedBytes = Buffer.from(JSON.stringify(preview, null, 2));
    writeFileSync(previewPath, changedBytes);

    await expect(
      new SchedulePreviewConfirmationService(
        config,
        jobs,
        pino({ enabled: false }),
        () => new Date("2026-07-31T01:00:00.000Z")
      ).execute({
        jobId,
        confirmation: jobId,
        previewSha256: calculateArtifactSha256(changedBytes)
      })
    ).rejects.toThrow("does not match the approved schedule plan");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });
  it("rejects an approval recorded after the readiness check", async () => {
    const { config, jobs, jobId, artifactDir } = fixture();
    const approvalPath = path.join(artifactDir, "schedule-approval.json");
    const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
    approval.approvedAt = "2026-07-31T00:00:01.000Z";
    const changedApprovalBytes = Buffer.from(JSON.stringify(approval));
    writeFileSync(approvalPath, changedApprovalBytes);
    const previewPath = path.join(artifactDir, "schedule-browser-preview.json");
    const preview = JSON.parse(readFileSync(previewPath, "utf8"));
    preview.evidence.approvalSha256 = calculateArtifactSha256(changedApprovalBytes);
    const changedPreviewBytes = Buffer.from(JSON.stringify(preview, null, 2));
    writeFileSync(previewPath, changedPreviewBytes);

    await expect(
      new SchedulePreviewConfirmationService(
        config,
        jobs,
        pino({ enabled: false }),
        () => new Date("2026-07-31T01:00:00.000Z")
      ).execute({
        jobId,
        confirmation: jobId,
        previewSha256: calculateArtifactSha256(changedPreviewBytes)
      })
    ).rejects.toThrow("invalid timestamp order");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });
  it("rejects preview evidence created before its readiness check", async () => {
    const { config, jobs, jobId, artifactDir } = fixture();
    const previewPath = path.join(artifactDir, "schedule-browser-preview.json");
    const preview = JSON.parse(readFileSync(previewPath, "utf8"));
    preview.evidence.previewedAt = "2026-07-30T23:59:59.999Z";
    const changedBytes = Buffer.from(JSON.stringify(preview, null, 2));
    writeFileSync(previewPath, changedBytes);
    const service = new SchedulePreviewConfirmationService(
      config,
      jobs,
      pino({ enabled: false }),
      () => new Date("2026-07-31T01:00:00.000Z")
    );

    await expect(
      service.execute({
        jobId,
        confirmation: jobId,
        previewSha256: calculateArtifactSha256(changedBytes)
      })
    ).rejects.toThrow("invalid timestamp order");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });
  it("rejects screenshot changes made after browser preview", async () => {
    const { config, jobs, jobId, screenshotPath, previewSha256 } = fixture();
    writeFileSync(
      screenshotPath,
      Buffer.concat([readFileSync(screenshotPath), Buffer.from("changed")])
    );
    const service = new SchedulePreviewConfirmationService(
      config,
      jobs,
      pino({ enabled: false })
    );
    await expect(
      service.execute({ jobId, confirmation: jobId, previewSha256 })
    ).rejects.toThrow("evidence has changed");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });
});
describe("ScheduleExecutionPackageService", () => {
  async function confirmFixture(
    data: ReturnType<typeof fixture>,
    confirmedAt = "2026-07-31T01:00:00.000Z"
  ) {
    await new SchedulePreviewConfirmationService(
      data.config,
      data.jobs,
      pino({ enabled: false }),
      () => new Date(confirmedAt)
    ).execute({
      jobId: data.jobId,
      confirmation: data.jobId,
      previewSha256: data.previewSha256
    });
    const confirmationBytes = readFileSync(
      path.join(data.artifactDir, "schedule-preview-confirmation.json")
    );
    return calculateArtifactSha256(confirmationBytes);
  }

  it("prepares a sealed local package while keeping execution disabled", async () => {
    const data = fixture();
    const previewConfirmationSha256 = await confirmFixture(data);
    const result = await new ScheduleExecutionPackageService(
      data.config,
      data.jobs,
      pino({ enabled: false }),
      () => new Date("2026-07-31T02:00:00.000Z")
    ).execute({
      jobId: data.jobId,
      confirmation: data.jobId,
      previewConfirmationSha256
    });

    expect(result.artifactType).toBe("schedule-execution-package");
    expect(result.schemaVersion).toBe(1);
    expect(result.evidenceChainValid).toBe(true);
    expect(result.executionEnabled).toBe(false);
    expect(result.executionAuthorized).toBe(false);
    expect(result.bloggerMutationPerformed).toBe(false);
    expect(result.requiresExternalExecutionImplementation).toBe(true);
    expect(data.jobs.find(data.jobId)?.status).toBe("PREVIEW_CONFIRMED");
    expect(
      JSON.parse(
        readFileSync(path.join(data.artifactDir, "schedule-execution-package.json"), "utf8")
      )
    ).toEqual(result);
  });

  it("does not overwrite an already sealed execution package", async () => {
    const data = fixture();
    const previewConfirmationSha256 = await confirmFixture(data);
    const service = new ScheduleExecutionPackageService(
      data.config,
      data.jobs,
      pino({ enabled: false }),
      () => new Date("2026-07-31T02:00:00.000Z")
    );
    const input = {
      jobId: data.jobId,
      confirmation: data.jobId,
      previewConfirmationSha256
    };
    const first = await service.execute(input);
    await expect(service.execute(input)).rejects.toThrow();
    expect(
      JSON.parse(
        readFileSync(path.join(data.artifactDir, "schedule-execution-package.json"), "utf8")
      )
    ).toEqual(first);
  });
  it("rejects a confirmation artifact with the wrong type or schema version", async () => {
    const data = fixture();
    await confirmFixture(data);
    const confirmationPath = path.join(
      data.artifactDir,
      "schedule-preview-confirmation.json"
    );
    const confirmation = JSON.parse(readFileSync(confirmationPath, "utf8"));
    const changedBytes = Buffer.from(
      JSON.stringify({ ...confirmation, artifactType: "wrong-artifact", schemaVersion: 2 })
    );
    writeFileSync(confirmationPath, changedBytes);

    await expect(
      new ScheduleExecutionPackageService(
        data.config,
        data.jobs,
        pino({ enabled: false }),
        () => new Date("2026-07-31T02:00:00.000Z")
      ).execute({
        jobId: data.jobId,
        confirmation: data.jobId,
        previewConfirmationSha256: calculateArtifactSha256(changedBytes)
      })
    ).rejects.toThrow("evidence is invalid");
    expect(existsSync(path.join(data.artifactDir, "schedule-execution-package.json"))).toBe(false);
  });
  it("rejects an unconfirmed confirmation artifact hash", async () => {
    const data = fixture();
    await confirmFixture(data);
    await expect(
      new ScheduleExecutionPackageService(
        data.config,
        data.jobs,
        pino({ enabled: false }),
        () => new Date("2026-07-31T02:00:00.000Z")
      ).execute({
        jobId: data.jobId,
        confirmation: data.jobId,
        previewConfirmationSha256: "0".repeat(64)
      })
    ).rejects.toThrow("SHA-256 does not match");
    expect(existsSync(path.join(data.artifactDir, "schedule-execution-package.json"))).toBe(false);
  });

  it("rechecks STOP immediately before writing the package", async () => {
    const data = fixture();
    const previewConfirmationSha256 = await confirmFixture(data);
    await expect(
      new ScheduleExecutionPackageService(
        data.config,
        data.jobs,
        pino({ enabled: false }),
        () => {
          writeFileSync(path.join(data.dir, "STOP"), "");
          return new Date("2026-07-31T02:00:00.000Z");
        }
      ).execute({
        jobId: data.jobId,
        confirmation: data.jobId,
        previewConfirmationSha256
      })
    ).rejects.toThrow("STOP");
    expect(existsSync(path.join(data.artifactDir, "schedule-execution-package.json"))).toBe(false);
  });
  it("audits the sealed package without enabling execution", async () => {
    const data = fixture();
    const previewConfirmationSha256 = await confirmFixture(data);
    await new ScheduleExecutionPackageService(
      data.config,
      data.jobs,
      pino({ enabled: false }),
      () => new Date("2026-07-31T02:00:00.000Z")
    ).execute({
      jobId: data.jobId,
      confirmation: data.jobId,
      previewConfirmationSha256
    });
    const packageBytes = readFileSync(
      path.join(data.artifactDir, "schedule-execution-package.json")
    );
    const result = await new ScheduleExecutionPackageAuditService(
      data.config,
      data.jobs,
      pino({ enabled: false }),
      () => new Date("2026-07-31T03:00:00.000Z")
    ).execute({
      jobId: data.jobId,
      packageSha256: calculateArtifactSha256(packageBytes)
    });

    expect(result.artifactType).toBe("schedule-execution-package-audit");
    expect(result.schemaVersion).toBe(1);
    expect(result.evidenceChainValid).toBe(true);
    expect(result.executionEnabled).toBe(false);
    expect(result.executionAuthorized).toBe(false);
    expect(result.bloggerMutationPerformed).toBe(false);
    expect(data.jobs.find(data.jobId)?.status).toBe("PREVIEW_CONFIRMED");
    expect(
      JSON.parse(
        readFileSync(
          path.join(data.artifactDir, "schedule-execution-package-audit.json"),
          "utf8"
        )
      )
    ).toEqual(result);
  });

  it("rejects a package whose scheduled time has passed by audit time", async () => {
    const data = fixture();
    const previewConfirmationSha256 = await confirmFixture(data);
    await new ScheduleExecutionPackageService(
      data.config,
      data.jobs,
      pino({ enabled: false }),
      () => new Date("2026-07-31T02:00:00.000Z")
    ).execute({
      jobId: data.jobId,
      confirmation: data.jobId,
      previewConfirmationSha256
    });
    const packageBytes = readFileSync(
      path.join(data.artifactDir, "schedule-execution-package.json")
    );

    await expect(
      new ScheduleExecutionPackageAuditService(
        data.config,
        data.jobs,
        pino({ enabled: false }),
        () => new Date("2026-08-02T00:00:00.000Z")
      ).execute({
        jobId: data.jobId,
        packageSha256: calculateArtifactSha256(packageBytes)
      })
    ).rejects.toThrow("invalid timestamp order");
  });
  it("rejects source evidence changed after package sealing", async () => {
    const data = fixture();
    const previewConfirmationSha256 = await confirmFixture(data);
    await new ScheduleExecutionPackageService(
      data.config,
      data.jobs,
      pino({ enabled: false }),
      () => new Date("2026-07-31T02:00:00.000Z")
    ).execute({
      jobId: data.jobId,
      confirmation: data.jobId,
      previewConfirmationSha256
    });
    const packageBytes = readFileSync(
      path.join(data.artifactDir, "schedule-execution-package.json")
    );
    writeFileSync(
      data.screenshotPath,
      Buffer.concat([readFileSync(data.screenshotPath), Buffer.from("tampered")])
    );

    await expect(
      new ScheduleExecutionPackageAuditService(
        data.config,
        data.jobs,
        pino({ enabled: false }),
        () => new Date("2026-07-31T03:00:00.000Z")
      ).execute({
        jobId: data.jobId,
        packageSha256: calculateArtifactSha256(packageBytes)
      })
    ).rejects.toThrow("evidence chain does not match");
  });
});