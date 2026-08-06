import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/env.js";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { migrate, openDatabase } from "../repositories/database.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { DraftSaveService } from "../services/draftSaveService.js";
import { StopRequestedError } from "../system/stop.js";

const blog = {
  blogKey: "blog-1",
  displayName: "Test Blog",
  adminUrl: "https://www.blogger.com/",
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
const article = {
  title: "下書き",
  html: "<p>本文</p>",
  labels: [],
  searchDescription: "説明",
  slug: "draft"
};

const noDrafts = async () => ({ title: article.title, editUrls: [], count: 0 });
function fixture(enabled = true) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "blogger-draft-"));
  const db = openDatabase(path.join(dir, "app.sqlite"));
  migrate(db);
  return {
    dir,
    config: loadConfig({
      DATA_DIR: dir,
      DATABASE_PATH: path.join(dir, "app.sqlite"),
      ENABLE_DRAFT_SAVE: String(enabled)
    }),
    repos: {
      blogs: new BlogRepository(db),
      jobs: new JobRepository(db),
      articles: new ArticleRepository(db)
    }
  };
}

describe("DraftSaveService", () => {
  it("records a draft save without using a real Blogger client", async () => {
    const { config, repos } = fixture();
    const saveDraft = vi.fn().mockImplementation(async (input) => {
      const screenshotPath = path.join(input.artifactDir, "screenshots", "draft.png");
      mkdirSync(path.dirname(screenshotPath), { recursive: true });
      writeFileSync(
        screenshotPath,
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
      return {
        screenshotPath,
        currentUrl: "https://www.blogger.com/blog/post/edit/1/2",
        savedAt: "2026-07-28T00:00:00.000Z"
      };
    });
    const service = new DraftSaveService(config, repos, pino({ enabled: false }), async () => ({
      findDrafts: noDrafts,
      saveDraft
    }));

    const result = await service.execute({ blog, article });

    expect(saveDraft).toHaveBeenCalledOnce();
    expect(repos.jobs.find(result.jobId)?.status).toBe("DRAFT_SAVED");
    expect(
      JSON.parse(readFileSync(path.join(result.artifactDir, "draft.json"), "utf8"))
    ).toMatchObject({
      currentUrl: "https://www.blogger.com/blog/post/edit/1/2"
    });
  });

  it("rechecks STOP at the browser mutation boundary", async () => {
    const { dir, config, repos } = fixture();
    const service = new DraftSaveService(config, repos, pino({ enabled: false }), async () => ({
      findDrafts: noDrafts,
      saveDraft: async (input) => {
        writeFileSync(path.join(dir, "STOP"), "");
        await input.assertCanMutate?.();
        throw new Error("mutation guard unexpectedly passed");
      }
    }));

    await expect(service.execute({ blog, article })).rejects.toBeInstanceOf(StopRequestedError);
  });
  it("marks the job failed when Blogger does not return a persisted edit URL", async () => {
    const { dir, config, repos } = fixture();
    const service = new DraftSaveService(config, repos, pino({ enabled: false }), async () => ({
      findDrafts: noDrafts,
      saveDraft: async () => ({
        screenshotPath: path.join(dir, "draft.png"),
        currentUrl: "https://www.blogger.com/blog/posts/1",
        savedAt: "2026-07-28T00:00:00.000Z"
      })
    }));

    await expect(service.execute({ blog, article })).rejects.toThrow("persisted Blogger edit URL");
    const [jobId] = readdirSync(path.join(dir, "jobs"));
    expect(repos.jobs.find(jobId)?.status).toBe("FAILED");
  });
  it("refuses to save when duplicate drafts are found", async () => {
    const { config, repos } = fixture();
    const saveDraft = vi.fn();
    const service = new DraftSaveService(config, repos, pino({ enabled: false }), async () => ({
      findDrafts: async () => ({
        title: article.title,
        editUrls: [
          "https://www.blogger.com/blog/post/edit/1/10",
          "https://www.blogger.com/blog/post/edit/1/20"
        ],
        count: 2
      }),
      saveDraft
    }));

    await expect(service.execute({ blog, article })).rejects.toThrow(
      "Duplicate Blogger drafts detected"
    );
    expect(saveDraft).not.toHaveBeenCalled();
  });
  it("fails closed when draft saving is disabled", async () => {
    const { config, repos } = fixture(false);
    const service = new DraftSaveService(config, repos, pino({ enabled: false }));
    await expect(service.execute({ blog, article })).rejects.toThrow("ENABLE_DRAFT_SAVE=false");
  });
});
