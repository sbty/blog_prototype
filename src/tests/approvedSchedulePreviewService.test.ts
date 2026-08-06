import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/env.js";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { migrate, openDatabase } from "../repositories/database.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { ApprovedSchedulePreviewService } from "../services/approvedSchedulePreviewService.js";
import { calculateArtifactSha256 } from "../services/scheduleApprovalIntegrity.js";

const article = {
  title: "Approved preview",
  html: "<p>body</p>",
  labels: [],
  searchDescription: "description",
  slug: "approved-preview",
  scheduledAt: "2026-08-02T00:00:00.000Z"
};

function fixture(env: Record<string, string> = {}, approved = true) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "approved-preview-"));
  const db = openDatabase(path.join(dir, "app.sqlite"));
  migrate(db);
  const blogs = new BlogRepository(db);
  const jobs = new JobRepository(db);
  const articles = new ArticleRepository(db);
  const blog = {
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
  };
  blogs.upsert(blog);
  const jobId = "schedule-approved-preview";
  const artifactDir = path.join(dir, "jobs", jobId);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(path.join(artifactDir, "schedule-approval.json"), "approved");
  jobs.create({
    id: jobId,
    blogKey: blog.blogKey,
    mode: "schedule",
    payload: article,
    artifactDir
  });
  jobs.updateStatus(jobId, "RUNNING", "started");
  jobs.updateStatus(jobId, "READY_FOR_POST", "ready");
  if (approved) jobs.updateStatus(jobId, "APPROVED_FOR_POST", "approved");
  return {
    dir,
    artifactDir,
    jobId,
    repos: { blogs, jobs, articles },
    config: loadConfig({
      DATA_DIR: dir,
      DATABASE_PATH: path.join(dir, "app.sqlite"),
      ...env
    })
  };
}

const readiness = {
  jobId: "schedule-approved-preview",
  checkedAt: "2026-07-31T00:00:00.000Z",
  planSha256: "a".repeat(64),
  localChecksPassed: true as const,
  executionEnabled: false as const,
  executionAuthorized: false as const,
  bloggerMutationPerformed: false as const,
  quota: { systemCount: 1, systemLimit: 3, blogCount: 1, blogLimit: 1 }
};

describe("ApprovedSchedulePreviewService", () => {
  it("previews an approved schedule through the mutation-blocked dry-run client", async () => {
    const { config, repos, jobId, artifactDir } = fixture();
    const screenshotPath = path.join(artifactDir, "screenshots", "dry-run.png");
    mkdirSync(path.dirname(screenshotPath), { recursive: true });
    writeFileSync(
      screenshotPath,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    const run = vi.fn().mockResolvedValue({
      screenshotPath,
      currentUrl: "https://www.blogger.com/blog/post/edit/123/456",
      publishButtonVisible: true,
      postSettings: {
        labels: [],
        searchDescription: "description",
        slug: "approved-preview",
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
    });
    const readinessChecker = { execute: vi.fn().mockResolvedValue(readiness) };
    const service = new ApprovedSchedulePreviewService(
      config,
      repos,
      pino({ enabled: false }),
      async () => ({ run }),
      readinessChecker
    );

    const result = await service.execute({ jobId });
    expect(readinessChecker.execute).toHaveBeenCalledWith({ jobId });
    expect(run).toHaveBeenCalledOnce();
    expect(result.bloggerMutationPerformed).toBe(false);
    expect(result.executionAuthorized).toBe(false);
    expect(result.dryRun.networkGuard.blockedMutationRequests).toBe(1);
    expect(result.evidence).toMatchObject({
      planSha256: readiness.planSha256
    });
    expect(result.evidence.approvalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence.screenshotSha256).toMatch(/^[a-f0-9]{64}$/);
    const artifactText = readFileSync(
      path.join(artifactDir, "schedule-browser-preview.json"),
      "utf8"
    );
    const artifact = JSON.parse(artifactText);
    const { previewArtifactSha256, ...resultArtifact } = result;
    expect(artifact).toEqual(resultArtifact);
    expect(previewArtifactSha256).toBe(calculateArtifactSha256(artifactText));
    expect(repos.jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });

  it("rechecks STOP after browser preview before recording evidence", async () => {
    const { dir, config, repos, jobId, artifactDir } = fixture();
    const screenshotPath = path.join(artifactDir, "screenshots", "dry-run.png");
    mkdirSync(path.dirname(screenshotPath), { recursive: true });
    writeFileSync(
      screenshotPath,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    const run = vi.fn().mockImplementation(async () => {
      writeFileSync(path.join(dir, "STOP"), "");
      return {
        screenshotPath,
        currentUrl: "https://www.blogger.com/blog/post/edit/123/456",
        publishButtonVisible: true,
        postSettings: {
          labels: [],
          searchDescription: "description",
          slug: "approved-preview",
          applied: true
        },
        networkGuard: {
          blockedMutationRequests: 1,
          blockedRequests: [{ method: "POST", url: "https://www.blogger.com/api/save" }],
          blockedRequestLogTruncated: false
        }
      };
    });
    const service = new ApprovedSchedulePreviewService(
      config,
      repos,
      pino({ enabled: false }),
      async () => ({ run }),
      { execute: vi.fn().mockResolvedValue(readiness) }
    );

    await expect(service.execute({ jobId })).rejects.toThrow("STOP");
    expect(repos.jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
    expect(existsSync(path.join(artifactDir, "schedule-browser-preview.json"))).toBe(false);
  });
  it("rejects preview when draft saving is enabled", async () => {
    const { config, repos, jobId } = fixture({ ENABLE_DRAFT_SAVE: "true" });
    const clientFactory = vi.fn();
    const service = new ApprovedSchedulePreviewService(
      config,
      repos,
      pino({ enabled: false }),
      clientFactory
    );
    await expect(service.execute({ jobId })).rejects.toThrow("ENABLE_DRAFT_SAVE=false");
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("rejects readiness that claims execution is enabled", async () => {
    const { config, repos, jobId } = fixture();
    const clientFactory = vi.fn();
    const readinessChecker = {
      execute: vi.fn().mockResolvedValue({ ...readiness, executionEnabled: true })
    };
    const service = new ApprovedSchedulePreviewService(
      config,
      repos,
      pino({ enabled: false }),
      clientFactory,
      readinessChecker
    );

    await expect(service.execute({ jobId })).rejects.toThrow("readiness result is invalid");
    expect(clientFactory).not.toHaveBeenCalled();
  });
  it("rejects readiness belonging to another job", async () => {
    const { config, repos, jobId } = fixture();
    const clientFactory = vi.fn();
    const readinessChecker = {
      execute: vi.fn().mockResolvedValue({ ...readiness, jobId: "different-job" })
    };
    const service = new ApprovedSchedulePreviewService(
      config,
      repos,
      pino({ enabled: false }),
      clientFactory,
      readinessChecker
    );

    await expect(service.execute({ jobId })).rejects.toThrow("belongs to another job");
    expect(clientFactory).not.toHaveBeenCalled();
  });
  it("rejects readiness dated after the preview start", async () => {
    const { config, repos, jobId } = fixture();
    const clientFactory = vi.fn();
    const readinessChecker = {
      execute: vi.fn().mockResolvedValue({
        ...readiness,
        checkedAt: "2026-08-02T00:00:00.000Z"
      })
    };
    const service = new ApprovedSchedulePreviewService(
      config,
      repos,
      pino({ enabled: false }),
      clientFactory,
      readinessChecker,
      () => new Date("2026-08-01T00:00:00.000Z")
    );

    await expect(service.execute({ jobId })).rejects.toThrow("invalid timestamp order");
    expect(clientFactory).not.toHaveBeenCalled();
  });
  it("rejects a schedule that is not approved", async () => {
    const { config, repos, jobId } = fixture({}, false);
    const clientFactory = vi.fn();
    const service = new ApprovedSchedulePreviewService(
      config,
      repos,
      pino({ enabled: false }),
      clientFactory
    );
    await expect(service.execute({ jobId })).rejects.toThrow("APPROVED_FOR_POST");
    expect(clientFactory).not.toHaveBeenCalled();
  });
});