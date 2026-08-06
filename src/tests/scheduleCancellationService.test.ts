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
import { ScheduleCancellationService } from "../services/scheduleCancellationService.js";

function fixture(scheduledPosting = false) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "schedule-cancel-"));
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
  jobs.updateStatus(jobId, "APPROVED_FOR_POST", "approved");
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
  return {
    dir,
    artifactDir,
    jobId,
    jobs,
    articles,
    config: loadConfig({
      DATA_DIR: dir,
      DATABASE_PATH: path.join(dir, "app.sqlite"),
      ENABLE_SCHEDULED_POST: String(scheduledPosting)
    })
  };
}

describe("ScheduleCancellationService", () => {
  it("cancels an approved local plan and releases its daily quota", async () => {
    const { config, jobs, articles, jobId, artifactDir } = fixture();
    expect(
      articles.countSchedulePlansForLocalDate({
        localDate: "2026-08-01",
        timezone: "Asia/Tokyo",
        blogKey: "blog-1"
      })
    ).toBe(1);
    const service = new ScheduleCancellationService(
      config,
      jobs,
      pino({ enabled: false }),
      () => new Date("2026-07-30T05:00:00.000Z")
    );

    const result = await service.execute({ jobId, confirmation: jobId });
    expect(jobs.find(jobId)?.status).toBe("CANCELLED");
    expect(result.bloggerMutationPerformed).toBe(false);
    expect(
      JSON.parse(readFileSync(path.join(artifactDir, "schedule-cancellation.json"), "utf8"))
    ).toEqual(result);
    expect(
      articles.countSchedulePlansForLocalDate({
        localDate: "2026-08-01",
        timezone: "Asia/Tokyo",
        blogKey: "blog-1"
      })
    ).toBe(0);
  });

  it("rejects a mismatched confirmation", async () => {
    const { config, jobs, jobId } = fixture();
    const service = new ScheduleCancellationService(config, jobs, pino({ enabled: false }));
    await expect(service.execute({ jobId, confirmation: "wrong" })).rejects.toThrow(
      "exactly match"
    );
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
  });

  it("rechecks STOP immediately before recording cancellation", async () => {
    const { config, dir, jobs, jobId, artifactDir } = fixture();
    const service = new ScheduleCancellationService(
      config,
      jobs,
      pino({ enabled: false }),
      () => {
        writeFileSync(path.join(dir, "STOP"), "");
        return new Date("2026-07-30T05:00:00.000Z");
      }
    );

    await expect(service.execute({ jobId, confirmation: jobId })).rejects.toThrow("STOP");
    expect(jobs.find(jobId)?.status).toBe("APPROVED_FOR_POST");
    expect(existsSync(path.join(artifactDir, "schedule-cancellation.json"))).toBe(false);
  });
  it("cancels a preview-confirmed plan", async () => {
    const { config, jobs, jobId } = fixture();
    jobs.updateStatus(jobId, "PREVIEW_CONFIRMED", "preview confirmed");
    const service = new ScheduleCancellationService(config, jobs, pino({ enabled: false }));
    await service.execute({ jobId, confirmation: jobId });
    expect(jobs.find(jobId)?.status).toBe("CANCELLED");
  });
  it("does not cancel an already cancelled plan twice", async () => {
    const { config, jobs, jobId } = fixture();
    jobs.updateStatus(jobId, "CANCELLED", "cancelled");
    const service = new ScheduleCancellationService(config, jobs, pino({ enabled: false }));
    await expect(service.execute({ jobId, confirmation: jobId })).rejects.toThrow(
      "READY_FOR_POST, APPROVED_FOR_POST, or PREVIEW_CONFIRMED"
    );
  });

  it("rejects cancellation when scheduled posting is enabled", async () => {
    const { config, jobs, jobId } = fixture(true);
    const service = new ScheduleCancellationService(config, jobs, pino({ enabled: false }));
    await expect(service.execute({ jobId, confirmation: jobId })).rejects.toThrow(
      "ENABLE_SCHEDULED_POST=false"
    );
  });
});