import { describe, expect, it, vi } from "vitest";
import type { BlogConfig } from "../config/blogConfig.js";
import { loadConfig } from "../config/env.js";
import type { ArticleInput } from "../domain/article.js";
import type { ScheduleCampaignManifest } from "../domain/scheduleCampaign.js";
import { ScheduleCampaignPreflightService } from "../services/scheduleCampaignPreflightService.js";

const now = () => new Date("2026-08-09T00:00:00.000Z");

function blog(blogKey: string, id: string, overrides: Partial<BlogConfig> = {}): BlogConfig {
  return {
    blogKey,
    displayName: `Blog ${blogKey}`,
    adminUrl: `https://www.blogger.com/blog/posts/${id}`,
    publicUrl: `https://${blogKey}.example.com`,
    language: "ja",
    targetCountry: "JP",
    primaryTheme: "testing",
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
    dailyPostLimit: 5,
    blogger: { selectorsPath: `./config/${blogKey}-selectors.json` },
    ...overrides
  };
}

function article(slug: string, scheduledAt: string, imagePath?: string): ArticleInput {
  return {
    title: `Article ${slug}`,
    html: `<p>${slug}</p>`,
    labels: ["campaign"],
    searchDescription: `Description ${slug}`,
    slug,
    scheduledAt,
    ...(imagePath ? { imagePath } : {})
  };
}

function setup(env: NodeJS.ProcessEnv = {}) {
  const config = loadConfig({
    ENABLE_DRY_RUN: "true",
    ENABLE_DRAFT_SAVE: "false",
    ENABLE_SCHEDULED_POST: "false",
    SYSTEM_DAILY_POST_LIMIT: "10",
    PER_BLOG_DAILY_POST_LIMIT: "5",
    AUTHORIZED_BLOG_IDS: "1111111111,2222222222",
    ...env
  });
  const countSchedulePlansForLocalDate = vi.fn(
    (input: { localDate: string; timezone: string; blogKey?: string }) => {
      void input;
      return 0;
    }
  );
  const validateImage = vi.fn(async () => undefined);
  const validateSelectors = vi.fn(async () => undefined);
  const service = new ScheduleCampaignPreflightService(
    config,
    { countSchedulePlansForLocalDate },
    { validateImage, validateSelectors },
    now
  );
  return { service, countSchedulePlansForLocalDate, validateImage, validateSelectors };
}

function validManifest(): ScheduleCampaignManifest {
  return {
    operation: "prepare-campaign",
    continueOnError: true,
    blogs: [blog("blog-a", "1111111111"), blog("blog-b", "2222222222")],
    items: [
      {
        blogKey: "blog-a",
        article: article("one", "2026-08-20T00:00:00.000Z", "./images/shared.png")
      },
      {
        blogKey: "blog-b",
        article: article("two", "2026-08-20T01:00:00.000Z", "./images/shared.png")
      }
    ]
  };
}

describe("ScheduleCampaignPreflightService", () => {
  it("validates all blogs and unique images without opening Blogger", async () => {
    const { service, validateImage, validateSelectors } = setup();
    const result = await service.execute(validManifest());

    expect(result).toMatchObject({
      checkedAt: "2026-08-09T00:00:00.000Z",
      passed: true,
      counts: { blogs: 2, items: 2, images: 1 },
      issues: [],
      warnings: []
    });
    expect(validateSelectors).toHaveBeenCalledTimes(2);
    expect(validateImage).toHaveBeenCalledTimes(1);
  });

  it("detects campaign-wide system and per-blog daily quota excess", async () => {
    const { service, countSchedulePlansForLocalDate } = setup({
      SYSTEM_DAILY_POST_LIMIT: "2",
      PER_BLOG_DAILY_POST_LIMIT: "2"
    });
    countSchedulePlansForLocalDate.mockImplementation(({ blogKey }) => (blogKey ? 1 : 1));
    const input = validManifest();
    input.items[1].blogKey = "blog-a";

    const result = await service.execute(input);

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["SYSTEM_DAILY_LIMIT_EXCEEDED", "BLOG_DAILY_LIMIT_EXCEEDED"])
    );
  });

  it("reports blog, selector, schedule, duplicate-slot, and image problems together", async () => {
    const { service, validateImage, validateSelectors } = setup();
    validateSelectors.mockRejectedValueOnce(new Error("selector file missing"));
    validateImage.mockRejectedValueOnce(new Error("image header invalid"));
    const input = validManifest();
    delete input.blogs[0].publicUrl;
    input.items[1].blogKey = "blog-a";
    input.items[1].article.scheduledAt = input.items[0].article.scheduledAt;

    const result = await service.execute(input);

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PUBLIC_URL_REQUIRED",
        "SELECTORS_INVALID",
        "DUPLICATE_SCHEDULE_SLOT",
        "IMAGE_INVALID"
      ])
    );
    expect(result.issues.filter((issue) => issue.code === "IMAGE_INVALID")).toHaveLength(2);
  });

  it("returns manifest errors without running file checks", async () => {
    const { service, validateImage, validateSelectors } = setup();
    const result = await service.execute({ operation: "wrong" });

    expect(result.passed).toBe(false);
    expect(result.issues.every((issue) => issue.code === "MANIFEST_INVALID")).toBe(true);
    expect(validateImage).not.toHaveBeenCalled();
    expect(validateSelectors).not.toHaveBeenCalled();
  });

  it("does not count resumed jobs against campaign quotas again", async () => {
    const { service, countSchedulePlansForLocalDate } = setup({
      SYSTEM_DAILY_POST_LIMIT: "1",
      PER_BLOG_DAILY_POST_LIMIT: "1"
    });
    countSchedulePlansForLocalDate.mockReturnValue(1);
    const input = validManifest();
    input.blogs = [input.blogs[0]];
    input.items = [{ ...input.items[0], resumeJobId: "schedule-job-existing" }];

    const result = await service.execute(input);

    expect(result.passed).toBe(true);
    expect(countSchedulePlansForLocalDate).not.toHaveBeenCalled();
  });

  it("fails closed when mutation safety flags are enabled", async () => {
    const { service } = setup({ ENABLE_SCHEDULED_POST: "true" });
    const result = await service.execute(validManifest());

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("MUTATION_FLAGS_ENABLED");
  });
});
