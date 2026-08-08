import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { BlogConfig } from "../config/blogConfig.js";
import { loadConfig } from "../config/env.js";
import type { ArticleInput } from "../domain/article.js";
import { ScheduleCampaignPreparationService } from "../services/scheduleCampaignPreparationService.js";
import { StopRequestedError } from "../system/stop.js";

const sha = (value: string) => value.repeat(64);

function blog(blogKey: string, id: string): BlogConfig {
  return {
    blogKey,
    displayName: `Blog ${blogKey}`,
    adminUrl: `https://www.blogger.com/blog/posts/${id}`,
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
    dailyPostLimit: 2,
    blogger: { selectorsPath: "./config/blogger-selectors.json" }
  };
}

function article(slug: string): ArticleInput {
  return {
    title: `Article ${slug}`,
    html: `<p>${slug}</p>`,
    labels: ["campaign"],
    searchDescription: `Description ${slug}`,
    slug,
    scheduledAt: "2026-08-20T00:00:00.000Z"
  };
}

function manifest() {
  return {
    operation: "prepare-campaign",
    blogs: [blog("blog-a", "1111111111"), blog("blog-b", "2222222222")],
    items: [
      { blogKey: "blog-a", article: article("one") },
      { blogKey: "blog-b", article: article("two") }
    ]
  };
}

function fixture(flags: { dryRun?: boolean; draft?: boolean; scheduled?: boolean } = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "blogger-campaign-"));
  const config = loadConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: path.join(dataDir, "app.sqlite"),
    ENABLE_DRY_RUN: String(flags.dryRun ?? true),
    ENABLE_DRAFT_SAVE: String(flags.draft ?? false),
    ENABLE_SCHEDULED_POST: String(flags.scheduled ?? false)
  });
  const plan = vi.fn(async (input: { blog: BlogConfig; article: ArticleInput }) => ({
    jobId: `job-${input.blog.blogKey}-${input.article.slug}`,
    artifactDir: path.join(dataDir, input.article.slug)
  }));
  const approve = vi.fn(async (input: { jobId: string; confirmation: string }) => ({
    approved: input.jobId === input.confirmation
  }));
  const prepare = vi.fn(async (input: { jobId: string; confirmation: string }) => ({
    previewSha256: sha("1"),
    previewConfirmationSha256: sha("2"),
    packageSha256: sha(input.jobId === input.confirmation ? "3" : "0"),
    auditSha256: sha("4")
  }));
  const recover = vi.fn(
    async (input: { jobId: string; blog: BlogConfig; article: ArticleInput }) => ({
      previewSha256: sha("5"),
      previewConfirmationSha256: sha("6"),
      packageSha256: sha(input.jobId && input.blog.blogKey && input.article.slug ? "7" : "0"),
      auditSha256: sha("8")
    })
  );
  const service = new ScheduleCampaignPreparationService(
    config,
    { plan, approve, prepare, recover },
    pino({ enabled: false })
  );
  return { dataDir, service, plan, approve, prepare, recover };
}

describe("ScheduleCampaignPreparationService", () => {
  it("prepares multiple articles across blogs and emits an executable manifest", async () => {
    const { service, plan, approve, prepare } = fixture();
    const result = await service.execute(manifest());

    expect(plan.mock.calls.map(([input]) => [input.blog.blogKey, input.article.slug])).toEqual([
      ["blog-a", "one"],
      ["blog-b", "two"]
    ]);
    expect(approve).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(result.counts).toEqual({ total: 2, succeeded: 2, failed: 0, skipped: 0 });
    expect(JSON.parse(readFileSync(result.executionManifestPath!, "utf8"))).toEqual({
      operation: "execute-schedules",
      continueOnError: true,
      items: [
        {
          jobId: "job-blog-a-one",
          confirmation: "job-blog-a-one",
          packageSha256: sha("3"),
          auditSha256: sha("4")
        },
        {
          jobId: "job-blog-b-two",
          confirmation: "job-blog-b-two",
          packageSha256: sha("3"),
          auditSha256: sha("4")
        }
      ]
    });
    expect(JSON.parse(readFileSync(result.reportPath, "utf8"))).toMatchObject({
      campaignId: result.campaignId,
      counts: result.counts
    });
  });

  it("validates the complete campaign before planning anything", async () => {
    const { service, plan } = fixture();
    const invalid = manifest();
    invalid.items[1].blogKey = "missing";
    delete invalid.items[0].article.scheduledAt;

    await expect(service.execute(invalid)).rejects.toThrow();
    expect(plan).not.toHaveBeenCalled();
  });

  it("records the failed phase and continues with later articles by default", async () => {
    const { service, plan, prepare, recover } = fixture();
    prepare.mockRejectedValueOnce(new Error("preview failed"));
    const result = await service.execute(manifest());

    expect(result.items[0]).toMatchObject({
      status: "FAILED",
      jobId: "job-blog-a-one",
      failedPhase: "PREPARATION",
      error: "preview failed"
    });
    expect(result.items[1].status).toBe("SUCCEEDED");
    expect(JSON.parse(readFileSync(result.executionManifestPath!, "utf8")).items).toHaveLength(1);
    const retryManifest = JSON.parse(readFileSync(result.retryManifestPath!, "utf8"));
    expect(retryManifest.items).toEqual([
      {
        blogKey: "blog-a",
        article: article("one"),
        resumeJobId: "job-blog-a-one"
      }
    ]);

    const retried = await service.execute(retryManifest);
    expect(retried.counts).toEqual({ total: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(plan).toHaveBeenCalledTimes(2);
  });

  it("skips remaining articles after STOP or fail-fast", async () => {
    const stopped = fixture();
    stopped.approve.mockRejectedValueOnce(
      new StopRequestedError(path.join(stopped.dataDir, "STOP"))
    );
    const stopResult = await stopped.service.execute(manifest());
    expect(stopResult.items.map((item) => item.status)).toEqual(["FAILED", "SKIPPED"]);

    const failFast = fixture();
    failFast.plan.mockRejectedValueOnce(new Error("plan failed"));
    const input = { ...manifest(), continueOnError: false };
    const failed = await failFast.service.execute(input);
    expect(failed.items.map((item) => item.status)).toEqual(["FAILED", "SKIPPED"]);
    expect(failed.items[0]).toMatchObject({ failedPhase: "PLAN" });
  });

  it("requires non-mutating feature flags", async () => {
    const dryRunDisabled = fixture({ dryRun: false });
    await expect(dryRunDisabled.service.execute(manifest())).rejects.toThrow("ENABLE_DRY_RUN=true");
    expect(dryRunDisabled.plan).not.toHaveBeenCalled();

    const scheduledEnabled = fixture({ scheduled: true });
    await expect(scheduledEnabled.service.execute(manifest())).rejects.toThrow(
      "ENABLE_SCHEDULED_POST=false"
    );
    expect(scheduledEnabled.plan).not.toHaveBeenCalled();
  });
});
