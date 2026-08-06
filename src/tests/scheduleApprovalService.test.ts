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
import { ScheduleApprovalService } from "../services/scheduleApprovalService.js";

function fixture(scheduledPosting = false) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "schedule-approval-"));
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
  jobs.create({
    id: jobId,
    blogKey: "blog-1",
    mode: "schedule",
    payload: {},
    artifactDir
  });
  jobs.updateStatus(jobId, "RUNNING", "started");
  jobs.updateStatus(jobId, "READY_FOR_POST", "ready");
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
  writeFileSync(
    path.join(artifactDir, "schedule-plan.json"),
    JSON.stringify({
      scheduledAt: "2026-08-01T00:00:00.000Z",
      date: "2026/08/01",
      time: "09:00",
      timezone: "Asia/Tokyo",
      mode: "local-plan",
      bloggerMutationPerformed: false,
      quota: { systemCount: 0, systemLimit: 3, blogCount: 0, blogLimit: 1 }
    })
  );
  return {
    db,
    articles,
    dir,
    artifactDir,
    jobId,
    jobs,
    config: loadConfig({
      DATA_DIR: dir,
      DATABASE_PATH: path.join(dir, "app.sqlite"),
      ENABLE_SCHEDULED_POST: String(scheduledPosting)
    })
  };
}

describe("ScheduleApprovalService", () => {
  it("approves a local plan with an exact job ID confirmation", async () => {
    const { config, articles, jobs, jobId, artifactDir } = fixture();
    const service = new ScheduleApprovalService(
      config,
      jobs,
      articles,
      pino({ enabled: false }),
      () => new Date("2026-07-30T04:00:00.000Z")
    );

    const approval = await service.execute({ jobId, confirmation: jobId });
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
    expect(approval.bloggerMutationPerformed).toBe(false);
    expect(approval.planSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      JSON.parse(readFileSync(path.join(artifactDir, "schedule-approval.json"), "utf8"))
    ).toEqual(approval);
  });

  it("records only the winning state event when approvals race", async () => {
    const { config, db, articles, jobs, jobId } = fixture();
    const service = new ScheduleApprovalService(
      config,
      jobs,
      articles,
      pino({ enabled: false }),
      () => new Date("2026-07-30T04:00:00.000Z")
    );
    const results = await Promise.allSettled([
      service.execute({ jobId, confirmation: jobId }),
      service.execute({ jobId, confirmation: jobId })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const events = db
      .prepare(
        "SELECT event_type AS eventType, COUNT(*) AS count FROM job_events WHERE job_id = ? AND event_type IN ('APPROVED_FOR_POST', 'SCHEDULE_APPROVED') GROUP BY event_type"
      )
      .all(jobId) as Array<{ eventType: string; count: number }>;
    expect(events).toEqual([{ eventType: "APPROVED_FOR_POST", count: 1 }]);
  });

  it("uses one clock reading for approval validation and evidence", async () => {
    const { config, articles, jobs, jobId } = fixture();
    const now = vi
      .fn()
      .mockReturnValueOnce(new Date("2026-07-30T04:00:00.000Z"))
      .mockReturnValue(new Date("2026-08-02T00:00:00.000Z"));
    const service = new ScheduleApprovalService(
      config,
      jobs,
      articles,
      pino({ enabled: false }),
      now
    );

    const approval = await service.execute({ jobId, confirmation: jobId });
    expect(approval.approvedAt).toBe("2026-07-30T04:00:00.000Z");
    expect(now).toHaveBeenCalledOnce();
  });
  it("rechecks STOP immediately before recording approval", async () => {
    const { config, articles, dir, jobs, jobId, artifactDir } = fixture();
    const service = new ScheduleApprovalService(
      config,
      jobs,
      articles,
      pino({ enabled: false }),
      () => {
        writeFileSync(path.join(dir, "STOP"), "");
        return new Date("2026-07-30T04:00:00.000Z");
      }
    );

    await expect(service.execute({ jobId, confirmation: jobId })).rejects.toThrow("STOP");
    expect(jobs.find(jobId)?.status).toBe("READY_FOR_POST");
    expect(existsSync(path.join(artifactDir, "schedule-approval.json"))).toBe(false);
  });
  it("rejects a mismatched confirmation", async () => {
    const { config, articles, jobs, jobId } = fixture();
    const service = new ScheduleApprovalService(config, jobs, articles, pino({ enabled: false }));
    await expect(service.execute({ jobId, confirmation: "wrong-job" })).rejects.toThrow(
      "exactly match"
    );
    expect(jobs.find(jobId)?.status).toBe("READY_FOR_POST");
  });

  it("rejects approval when scheduled posting is enabled", async () => {
    const { config, articles, jobs, jobId } = fixture(true);
    const service = new ScheduleApprovalService(config, jobs, articles, pino({ enabled: false }));
    await expect(service.execute({ jobId, confirmation: jobId })).rejects.toThrow(
      "ENABLE_SCHEDULED_POST=false"
    );
  });

  it("rejects internally inconsistent schedule display fields before approval", async () => {
    const { config, articles, jobs, jobId, artifactDir } = fixture();
    const planPath = path.join(artifactDir, "schedule-plan.json");
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    writeFileSync(planPath, JSON.stringify({ ...plan, date: "2026/08/02" }));
    const service = new ScheduleApprovalService(
      config,
      jobs,
      articles,
      pino({ enabled: false }),
      () => new Date("2026-07-30T04:00:00.000Z")
    );
    await expect(service.execute({ jobId, confirmation: jobId })).rejects.toThrow(
      "missing or invalid"
    );
    expect(jobs.find(jobId)?.status).toBe("READY_FOR_POST");
  });

  it("rejects a valid schedule rendered in a timezone other than APP_TIMEZONE", async () => {
    const { config, articles, jobs, jobId, artifactDir } = fixture();
    const planPath = path.join(artifactDir, "schedule-plan.json");
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    writeFileSync(
      planPath,
      JSON.stringify({ ...plan, date: "2026/08/01", time: "00:00", timezone: "UTC" })
    );
    const service = new ScheduleApprovalService(
      config,
      jobs,
      articles,
      pino({ enabled: false }),
      () => new Date("2026-07-30T04:00:00.000Z")
    );
    await expect(service.execute({ jobId, confirmation: jobId })).rejects.toThrow(
      "display time does not match scheduledAt"
    );
    expect(jobs.find(jobId)?.status).toBe("READY_FOR_POST");
  });

  it("rejects a plan whose scheduled time is no longer safely in the future", async () => {
    const { config, articles, jobs, jobId } = fixture();
    const service = new ScheduleApprovalService(
      config,
      jobs,
      articles,
      pino({ enabled: false }),
      () => new Date("2026-08-01T00:00:00.000Z")
    );
    await expect(service.execute({ jobId, confirmation: jobId })).rejects.toThrow(
      "at least 10 minutes"
    );
    expect(jobs.find(jobId)?.status).toBe("READY_FOR_POST");
  });
  it("rejects a plan that is not local-only", async () => {
    const { config, articles, jobs, jobId, artifactDir } = fixture();
    writeFileSync(
      path.join(artifactDir, "schedule-plan.json"),
      JSON.stringify({ mode: "remote", bloggerMutationPerformed: true })
    );
    const service = new ScheduleApprovalService(config, jobs, articles, pino({ enabled: false }));
    await expect(service.execute({ jobId, confirmation: jobId })).rejects.toThrow(
      "missing or invalid"
    );
  });

  it("rejects a plan containing fields outside the artifact contract", async () => {
    const { config, articles, jobs, jobId, artifactDir } = fixture();
    const planPath = path.join(artifactDir, "schedule-plan.json");
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    writeFileSync(planPath, JSON.stringify({ ...plan, executionEnabled: true }));
    const service = new ScheduleApprovalService(config, jobs, articles, pino({ enabled: false }));

    await expect(service.execute({ jobId, confirmation: jobId })).rejects.toThrow(
      "missing or invalid"
    );
    expect(jobs.find(jobId)?.status).toBe("READY_FOR_POST");
  });
});