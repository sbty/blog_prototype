import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/env.js";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { migrate, openDatabase } from "../repositories/database.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { SchedulePlanService } from "../services/schedulePlanService.js";

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

function fixture(
  scheduledPosting = false,
  limits: { system?: number; perBlog?: number } = {}
) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "schedule-plan-"));
  const db = openDatabase(path.join(dir, "app.sqlite"));
  migrate(db);
  return {
    dir,
    config: loadConfig({
      DATA_DIR: dir,
      DATABASE_PATH: path.join(dir, "app.sqlite"),
      APP_TIMEZONE: "Asia/Tokyo",
      ENABLE_SCHEDULED_POST: String(scheduledPosting),
      SYSTEM_DAILY_POST_LIMIT: String(limits.system ?? 3),
      PER_BLOG_DAILY_POST_LIMIT: String(limits.perBlog ?? 1)
    }),
    repos: {
      blogs: new BlogRepository(db),
      jobs: new JobRepository(db),
      articles: new ArticleRepository(db)
    }
  };
}

const article = {
  title: "Schedule plan",
  html: "<p>body</p>",
  labels: [],
  searchDescription: "description",
  slug: "schedule-plan",
  scheduledAt: "2026-08-01T09:00:00+09:00"
};

describe("SchedulePlanService", () => {
  it("creates a local-only schedule plan artifact", async () => {
    const { config, repos } = fixture();
    const service = new SchedulePlanService(
      config,
      repos,
      pino({ enabled: false }),
      () => new Date("2026-07-30T00:00:00.000Z")
    );

    const result = await service.execute({ blog, article });
    expect(repos.jobs.find(result.jobId)?.status).toBe("READY_FOR_POST");
    expect(result.plan).toMatchObject({
      date: "2026/08/01",
      time: "09:00",
      timezone: "Asia/Tokyo",
      mode: "local-plan",
      bloggerMutationPerformed: false
    });
    expect(
      JSON.parse(readFileSync(path.join(result.artifactDir, "schedule-plan.json"), "utf8"))
    ).toEqual(result.plan);
  });

  it("enforces the per-blog daily schedule limit", async () => {
    const { config, repos } = fixture();
    const service = new SchedulePlanService(
      config,
      repos,
      pino({ enabled: false }),
      () => new Date("2026-07-30T00:00:00.000Z")
    );

    const first = await service.execute({ blog, article });
    expect(first.plan.quota).toMatchObject({
      systemCount: 0,
      systemLimit: 3,
      blogCount: 0,
      blogLimit: 1
    });
    repos.jobs.updateStatus(first.jobId, "APPROVED_FOR_POST", "approved");
    await expect(
      service.execute({ blog, article: { ...article, title: "Second plan", slug: "second-plan" } })
    ).rejects.toThrow("Blog daily schedule limit reached");
  });
  it("enforces the system daily schedule limit across blogs", async () => {
    const { config, repos } = fixture(false, { system: 1, perBlog: 2 });
    const service = new SchedulePlanService(
      config,
      repos,
      pino({ enabled: false }),
      () => new Date("2026-07-30T00:00:00.000Z")
    );
    const first = await service.execute({ blog, article });
    repos.jobs.updateStatus(first.jobId, "APPROVED_FOR_POST", "approved");

    const secondBlog = {
      ...blog,
      blogKey: "blog-2",
      displayName: "Second Blog",
      adminUrl: "https://www.blogger.com/blog/posts/456"
    };
    await expect(
      service.execute({
        blog: secondBlog,
        article: { ...article, title: "Second blog plan", slug: "second-blog-plan" }
      })
    ).rejects.toThrow("System daily schedule limit reached");
  });
  it("fails closed when concurrent plans race for the same quota slot", async () => {
    const { config, repos } = fixture();
    const service = new SchedulePlanService(
      config,
      repos,
      pino({ enabled: false }),
      () => new Date("2026-07-30T00:00:00.000Z")
    );

    const results = await Promise.allSettled([
      service.execute({ blog, article: { ...article, title: "Concurrent A", slug: "a" } }),
      service.execute({ blog, article: { ...article, title: "Concurrent B", slug: "b" } })
    ]);
    expect(results.some((result) => result.status === "rejected")).toBe(true);
    expect(
      repos.articles.countSchedulePlansForLocalDate({
        localDate: "2026-08-01",
        timezone: "Asia/Tokyo",
        blogKey: blog.blogKey
      })
    ).toBeLessThanOrEqual(1);
  });

  it("fails closed when scheduled posting is enabled", async () => {
    const { config, repos } = fixture(true);
    const service = new SchedulePlanService(config, repos, pino({ enabled: false }));
    await expect(service.execute({ blog, article })).rejects.toThrow(
      "ENABLE_SCHEDULED_POST=false"
    );
  });

  it("rechecks STOP immediately before marking the plan ready", async () => {
    const { dir, config, repos } = fixture();
    const service = new SchedulePlanService(
      config,
      repos,
      pino({ enabled: false }),
      () => {
        writeFileSync(path.join(dir, "STOP"), "");
        return new Date("2026-07-30T00:00:00.000Z");
      }
    );

    await expect(service.execute({ blog, article })).rejects.toThrow("STOP");
    const [jobId] = readdirSync(path.join(dir, "jobs"));
    expect(repos.jobs.find(jobId)?.status).toBe("STOPPED");
  });
  it("requires scheduledAt", async () => {
    const { config, repos } = fixture();
    const service = new SchedulePlanService(config, repos, pino({ enabled: false }));
    const withoutSchedule = { ...article, scheduledAt: undefined };
    await expect(service.execute({ blog, article: withoutSchedule })).rejects.toThrow(
      "article.scheduledAt"
    );
  });
});