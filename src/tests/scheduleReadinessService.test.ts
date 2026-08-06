import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/env.js";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { migrate, openDatabase } from "../repositories/database.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { calculateSchedulePlanSha256 } from "../services/scheduleApprovalIntegrity.js";
import { ScheduleReadinessService } from "../services/scheduleReadinessService.js";

function fixture(approved = true) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "schedule-readiness-"));
  const db = openDatabase(path.join(dir, "app.sqlite"));
  migrate(db);
  const blogs = new BlogRepository(db);
  const jobs = new JobRepository(db);
  const articles = new ArticleRepository(db);
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
  const jobId = "schedule-plan-test";
  const artifactDir = path.join(dir, "jobs", jobId);
  mkdirSync(artifactDir, { recursive: true });
  jobs.create({ id: jobId, blogKey: "blog-1", mode: "schedule", payload: {}, artifactDir });
  jobs.updateStatus(jobId, "RUNNING", "started");
  jobs.updateStatus(jobId, "READY_FOR_POST", "ready");
  if (approved) jobs.updateStatus(jobId, "APPROVED_FOR_POST", "approved");
  articles.create({
    id: "article-schedule-plan-test",
    jobId,
    blogKey: "blog-1",
    title: "Schedule plan",
    html: "<p>body</p>",
    labels: [],
    searchDescription: "description",
    slug: "schedule-plan",
    scheduledAt: "2026-08-01T00:00:00.000Z"
  });
  const planText = JSON.stringify({
    scheduledAt: "2026-08-01T00:00:00.000Z",
    date: "2026/08/01",
    time: "09:00",
    timezone: "Asia/Tokyo",
    mode: "local-plan",
    bloggerMutationPerformed: false,
    quota: { systemCount: 0, systemLimit: 3, blogCount: 0, blogLimit: 1 }
  });
  writeFileSync(path.join(artifactDir, "schedule-plan.json"), planText);
  writeFileSync(
    path.join(artifactDir, "schedule-approval.json"),
    JSON.stringify({
      jobId,
      approvedAt: "2026-07-30T04:00:00.000Z",
      confirmationMatched: true,
      bloggerMutationPerformed: false,
      planSha256: calculateSchedulePlanSha256(planText)
    })
  );
  return {
    dir,
    artifactDir,
    jobId,
    jobs,
    repos: { jobs, articles, blogs },
    config: loadConfig({ DATA_DIR: dir, DATABASE_PATH: path.join(dir, "app.sqlite") })
  };
}

describe("ScheduleReadinessService", () => {
  it("writes a local-only readiness artifact for an intact approval", async () => {
    const { config, jobs, repos, jobId, artifactDir } = fixture();
    const service = new ScheduleReadinessService(
      config,
      repos,
      pino({ enabled: false }),
      () => new Date("2026-07-30T04:00:00.000Z")
    );
    const result = await service.execute({ jobId });
    expect(result).toMatchObject({
      localChecksPassed: true,
      executionEnabled: false,
      executionAuthorized: false,
      bloggerMutationPerformed: false
    });
    expect(
      JSON.parse(readFileSync(path.join(artifactDir, "schedule-readiness.json"), "utf8"))
    ).toEqual(result);
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });

  it("rejects a plan modified after approval", async () => {
    const { config, repos, jobId, artifactDir } = fixture();
    writeFileSync(path.join(artifactDir, "schedule-plan.json"), "{}");
    const service = new ScheduleReadinessService(config, repos, pino({ enabled: false }));
    await expect(service.execute({ jobId })).rejects.toThrow("changed since approval");
  });

  it("rejects readiness when the current per-blog quota is exceeded", async () => {
    const { config, repos, jobs, jobId, artifactDir } = fixture();
    const secondJobId = "schedule-plan-second";
    const secondArtifactDir = path.join(path.dirname(artifactDir), secondJobId);
    mkdirSync(secondArtifactDir, { recursive: true });
    jobs.create({
      id: secondJobId,
      blogKey: "blog-1",
      mode: "schedule",
      payload: {},
      artifactDir: secondArtifactDir
    });
    jobs.updateStatus(secondJobId, "RUNNING", "started");
    jobs.updateStatus(secondJobId, "READY_FOR_POST", "ready");
    repos.articles.create({
      id: "article-schedule-plan-second",
      jobId: secondJobId,
      blogKey: "blog-1",
      title: "Second schedule",
      html: "<p>body</p>",
      labels: [],
      searchDescription: "description",
      slug: "second-schedule",
      scheduledAt: "2026-08-01T01:00:00.000Z"
    });
    const service = new ScheduleReadinessService(
      config,
      repos,
      pino({ enabled: false }),
      () => new Date("2026-07-30T04:00:00.000Z")
    );
    await expect(service.execute({ jobId })).rejects.toThrow(
      "Blog daily schedule limit exceeded"
    );
  });
  it("rejects a structurally invalid plan even when its approval hash was recomputed", async () => {
    const { config, repos, jobId, artifactDir } = fixture();
    const planPath = path.join(artifactDir, "schedule-plan.json");
    const approvalPath = path.join(artifactDir, "schedule-approval.json");
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    plan.quota.systemLimit = 0;
    const changedPlanText = JSON.stringify(plan);
    writeFileSync(planPath, changedPlanText);
    const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
    approval.planSha256 = calculateSchedulePlanSha256(changedPlanText);
    writeFileSync(approvalPath, JSON.stringify(approval));

    const service = new ScheduleReadinessService(config, repos, pino({ enabled: false }));
    await expect(service.execute({ jobId })).rejects.toThrow("plan artifact is invalid");
  });
  it("rejects an approval timestamp later than its readiness check", async () => {
    const { config, repos, jobId, artifactDir } = fixture();
    const approvalPath = path.join(artifactDir, "schedule-approval.json");
    const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
    approval.approvedAt = "2026-07-30T05:00:00.000Z";
    writeFileSync(approvalPath, JSON.stringify(approval));
    const service = new ScheduleReadinessService(
      config,
      repos,
      pino({ enabled: false }),
      () => new Date("2026-07-30T04:00:00.000Z")
    );

    await expect(service.execute({ jobId })).rejects.toThrow("invalid timestamp order");
  });
  it("rechecks STOP immediately before recording readiness", async () => {
    const { config, dir, repos, jobs, jobId, artifactDir } = fixture();
    const service = new ScheduleReadinessService(
      config,
      repos,
      pino({ enabled: false }),
      () => {
        writeFileSync(path.join(dir, "STOP"), "");
        return new Date("2026-07-30T04:00:00.000Z");
      }
    );

    await expect(service.execute({ jobId })).rejects.toThrow("STOP");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
    expect(existsSync(path.join(artifactDir, "schedule-readiness.json"))).toBe(false);
  });
  it("rejects a job that is not approved", async () => {
    const { config, repos, jobId } = fixture(false);
    const service = new ScheduleReadinessService(config, repos, pino({ enabled: false }));
    await expect(service.execute({ jobId })).rejects.toThrow("APPROVED_FOR_POST");
  });
});