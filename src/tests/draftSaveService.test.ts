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
  adminUrl: "https://www.blogger.com/blog/posts/1111111111",
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
const passingPersistenceAudit = {
  execute: vi.fn(async () => ({ status: "PASS", reasons: [] }))
};
function fixture(enabled = true, authorized = "1111111111") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "blogger-draft-"));
  const db = openDatabase(path.join(dir, "app.sqlite"));
  migrate(db);
  return {
    dir,
    config: loadConfig({
      DATA_DIR: dir,
      DATABASE_PATH: path.join(dir, "app.sqlite"),
      ENABLE_DRAFT_SAVE: String(enabled),
      AUTHORIZED_TEST_BLOG_ID: authorized
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
      writeFileSync(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      return {
        screenshotPath,
        currentUrl: "https://www.blogger.com/blog/post/edit/1111111111/2222222222",
        savedAt: "2026-07-28T00:00:00.000Z"
      };
    });
    const service = new DraftSaveService(
      config,
      repos,
      pino({ enabled: false }),
      async () => ({
        findDrafts: noDrafts,
        saveDraft
      }),
      passingPersistenceAudit as never
    );

    const result = await service.execute({ blog, article });

    expect(saveDraft).toHaveBeenCalledOnce();
    expect(passingPersistenceAudit.execute).toHaveBeenCalledWith({
      blog,
      article,
      postId: "2222222222",
      postEditorUrl: "https://www.blogger.com/blog/post/edit/1111111111/2222222222"
    });
    expect(repos.jobs.find(result.jobId)?.status).toBe("DRAFT_SAVED");
    expect(
      JSON.parse(readFileSync(path.join(result.artifactDir, "draft.json"), "utf8"))
    ).toMatchObject({
      currentUrl: "https://www.blogger.com/blog/post/edit/1111111111/2222222222"
    });
  });

  it("rechecks STOP at the browser mutation boundary", async () => {
    const { dir, config, repos } = fixture();
    const service = new DraftSaveService(
      config,
      repos,
      pino({ enabled: false }),
      async () => ({
        findDrafts: noDrafts,
        saveDraft: async (input) => {
          writeFileSync(path.join(dir, "STOP"), "");
          await input.assertCanMutate?.();
          throw new Error("mutation guard unexpectedly passed");
        }
      }),
      passingPersistenceAudit as never
    );

    await expect(service.execute({ blog, article })).rejects.toBeInstanceOf(StopRequestedError);
  });

  it("fails closed after save when a new-context persistence audit finds an empty permalink", async () => {
    const { config, repos } = fixture();
    const saveDraft = vi.fn().mockImplementation(async (input) => {
      const screenshotPath = path.join(input.artifactDir, "screenshots", "draft.png");
      mkdirSync(path.dirname(screenshotPath), { recursive: true });
      writeFileSync(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      return {
        screenshotPath,
        currentUrl: "https://www.blogger.com/blog/post/edit/1111111111/2222222222",
        savedAt: "2026-07-28T00:00:00.000Z"
      };
    });
    const persistenceAudit = {
      execute: vi.fn(async () => ({
        status: "FAIL",
        reasons: ['permalink: expected "draft", actual ""']
      }))
    } as never;
    const service = new DraftSaveService(
      config,
      repos,
      pino({ enabled: false }),
      async () => ({
        findDrafts: noDrafts,
        saveDraft
      }),
      persistenceAudit
    );

    await expect(service.execute({ blog, article })).rejects.toThrow("persistence audit failed");
    expect(saveDraft).toHaveBeenCalledOnce();
    const [jobId] = readdirSync(path.join(config.DATA_DIR, "jobs"));
    expect(repos.jobs.find(jobId)?.status).toBe("FAILED");
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
  it("refuses to create a second draft when one matching draft already exists", async () => {
    const { config, repos } = fixture();
    const saveDraft = vi.fn();
    const service = new DraftSaveService(config, repos, pino({ enabled: false }), async () => ({
      findDrafts: async () => ({
        title: article.title,
        editUrls: ["https://www.blogger.com/blog/post/edit/1/10"],
        count: 1
      }),
      saveDraft
    }));

    await expect(service.execute({ blog, article })).rejects.toThrow(
      "A Blogger draft already exists"
    );
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("requires an explicit flag before updating an existing matching draft", async () => {
    const { config, repos } = fixture();
    const saveDraft = vi.fn();
    const existingBlog = {
      ...blog,
      blogger: {
        ...blog.blogger,
        postEditorUrl: "https://www.blogger.com/blog/post/edit/1111111111/2222222222"
      }
    };
    const service = new DraftSaveService(
      config,
      repos,
      pino({ enabled: false }),
      async () => ({
        findDrafts: async () => ({
          title: article.title,
          editUrls: [existingBlog.blogger.postEditorUrl],
          count: 1
        }),
        saveDraft
      }),
      passingPersistenceAudit as never
    );

    await expect(service.execute({ blog: existingBlog, article })).rejects.toThrow(
      "Existing draft update requires ENABLE_EXISTING_DRAFT_UPDATE=true"
    );
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("updates only the configured existing draft when explicitly enabled", async () => {
    const { config, repos } = fixture();
    const enabledConfig = { ...config, ENABLE_EXISTING_DRAFT_UPDATE: true };
    const existingBlog = {
      ...blog,
      blogger: {
        ...blog.blogger,
        postEditorUrl: "https://www.blogger.com/blog/post/edit/1111111111/2222222222"
      }
    };
    const saveDraft = vi.fn().mockImplementation(async (input) => {
      const screenshotPath = path.join(input.artifactDir, "screenshots", "draft.png");
      mkdirSync(path.dirname(screenshotPath), { recursive: true });
      writeFileSync(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      return {
        screenshotPath,
        currentUrl: existingBlog.blogger.postEditorUrl,
        savedAt: "2026-07-28T00:00:00.000Z"
      };
    });
    const service = new DraftSaveService(
      enabledConfig,
      repos,
      pino({ enabled: false }),
      async () => ({
        findDrafts: async () => ({
          title: article.title,
          editUrls: [existingBlog.blogger.postEditorUrl],
          count: 1
        }),
        saveDraft
      }),
      passingPersistenceAudit as never
    );

    await service.execute({ blog: existingBlog, article });
    expect(saveDraft).toHaveBeenCalledOnce();
  });
  it("fails closed when draft saving is disabled", async () => {
    const { config, repos } = fixture(false);
    const service = new DraftSaveService(config, repos, pino({ enabled: false }));
    await expect(service.execute({ blog, article })).rejects.toThrow("ENABLE_DRAFT_SAVE=false");
  });

  it("refuses a draft save unless the blog is explicitly authorized", async () => {
    const { config, repos } = fixture(true, "2222222222");
    const saveDraft = vi.fn();
    const service = new DraftSaveService(config, repos, pino({ enabled: false }), async () => ({
      findDrafts: noDrafts,
      saveDraft
    }));

    await expect(service.execute({ blog, article })).rejects.toThrow(
      "Draft save is not authorized for blog 1111111111"
    );
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("fails closed when no draft-save blog is authorized", async () => {
    const { config, repos } = fixture(true, "");
    const saveDraft = vi.fn();
    const service = new DraftSaveService(config, repos, pino({ enabled: false }), async () => ({
      findDrafts: noDrafts,
      saveDraft
    }));

    await expect(service.execute({ blog, article })).rejects.toThrow(
      "Draft save requires AUTHORIZED_BLOG_IDS or AUTHORIZED_TEST_BLOG_ID"
    );
    expect(saveDraft).not.toHaveBeenCalled();
  });
});
