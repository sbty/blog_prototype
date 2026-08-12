import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/env.js";
import { BatchExecutionService } from "../services/batchExecutionService.js";
import { StopRequestedError } from "../system/stop.js";

function blog(blogKey: string) {
  const blogId = blogKey === "blog-1" ? "1111111111" : "2222222222";
  return {
    blogKey,
    displayName: `Blog ${blogKey}`,
    adminUrl: `https://www.blogger.com/blog/posts/${blogId}`,
    primaryTheme: "testing",
    blogger: {
      postEditorUrl: `https://www.blogger.com/blog/post/edit/${blogId}/3333333333`
    }
  };
}

function article(slug: string, scheduledAt?: string) {
  return {
    title: `Article ${slug}`,
    html: `<p>${slug}</p>`,
    labels: ["batch"],
    searchDescription: `Description ${slug}`,
    slug,
    ...(scheduledAt ? { scheduledAt } : {})
  };
}

function fixture(input: { draftEnabled?: boolean; dryRunEnabled?: boolean } = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "blogger-batch-"));
  const config = loadConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: path.join(dataDir, "app.sqlite"),
    ENABLE_DRY_RUN: String(input.dryRunEnabled ?? true),
    ENABLE_DRAFT_SAVE: String(input.draftEnabled ?? true),
    ENABLE_SCHEDULED_POST: "false"
  });
  type ExecutorInput = { blog: { blogKey: string }; article: { slug: string } };
  const dryRun = vi.fn(async ({ article: item }: ExecutorInput) => ({
    jobId: `dryrun-${item.slug}`,
    artifactDir: path.join(dataDir, item.slug)
  }));
  const saveDraft = vi.fn(async ({ article: item }: ExecutorInput) => ({
    jobId: `draft-${item.slug}`,
    artifactDir: path.join(dataDir, item.slug)
  }));
  const planSchedule = vi.fn(async ({ article: item }: ExecutorInput) => ({
    jobId: `schedule-${item.slug}`,
    artifactDir: path.join(dataDir, item.slug)
  }));
  const service = new BatchExecutionService(
    config,
    { dryRun, saveDraft, planSchedule },
    pino({ enabled: false })
  );
  return { dataDir, service, dryRun, saveDraft, planSchedule };
}

describe("BatchExecutionService", () => {
  it("executes a safe dry-run batch with mutation flags disabled", async () => {
    const { service, dryRun } = fixture({ draftEnabled: false });
    const result = await service.execute({
      operation: "dry-run",
      blogs: [blog("blog-1"), blog("blog-2")],
      items: [
        { blogKey: "blog-1", article: article("one") },
        { blogKey: "blog-2", article: article("two") }
      ]
    });

    expect(dryRun.mock.calls.map(([input]) => input.blog.blogKey)).toEqual(["blog-1", "blog-2"]);
    expect(result).toMatchObject({
      operation: "dry-run",
      counts: { total: 2, succeeded: 2, failed: 0, skipped: 0 }
    });
  });

  it("executes multiple articles across multiple blogs and writes a report", async () => {
    const { service, saveDraft } = fixture();
    const result = await service.execute({
      operation: "save-drafts",
      blogs: [blog("blog-1"), blog("blog-2")],
      items: [
        { blogKey: "blog-1", article: article("one") },
        { blogKey: "blog-2", article: article("two") },
        { blogKey: "blog-1", article: article("three") }
      ]
    });

    expect(saveDraft.mock.calls.map(([input]) => [input.blog.blogKey, input.article.slug])).toEqual(
      [
        ["blog-1", "one"],
        ["blog-2", "two"],
        ["blog-1", "three"]
      ]
    );
    expect(result.counts).toEqual({ total: 3, succeeded: 3, failed: 0, skipped: 0 });
    expect(JSON.parse(readFileSync(result.reportPath, "utf8"))).toMatchObject({
      batchId: result.batchId,
      counts: result.counts
    });
  });

  it("validates the entire manifest before executing any item", async () => {
    const { service, saveDraft } = fixture();
    await expect(
      service.execute({
        operation: "save-drafts",
        blogs: [blog("blog-1")],
        items: [
          { blogKey: "blog-1", article: article("same") },
          { blogKey: "missing", article: article("same") }
        ]
      })
    ).rejects.toThrow("Unknown blogKey");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("continues after an item failure by default", async () => {
    const { service, saveDraft } = fixture();
    saveDraft.mockRejectedValueOnce(new Error("first failed"));
    const result = await service.execute({
      operation: "save-drafts",
      blogs: [blog("blog-1")],
      items: [
        { blogKey: "blog-1", article: article("one") },
        { blogKey: "blog-1", article: article("two") }
      ]
    });
    expect(result.items.map((item) => item.status)).toEqual(["FAILED", "SUCCEEDED"]);
    expect(result.counts).toEqual({ total: 2, succeeded: 1, failed: 1, skipped: 0 });
  });

  it("skips remaining items after fail-fast or STOP", async () => {
    const { service, saveDraft } = fixture();
    saveDraft.mockRejectedValueOnce(new Error("first failed"));
    const failed = await service.execute({
      operation: "save-drafts",
      continueOnError: false,
      blogs: [blog("blog-1")],
      items: [
        { blogKey: "blog-1", article: article("one") },
        { blogKey: "blog-1", article: article("two") }
      ]
    });
    expect(failed.items.map((item) => item.status)).toEqual(["FAILED", "SKIPPED"]);

    const stoppedFixture = fixture();
    stoppedFixture.saveDraft.mockRejectedValueOnce(
      new StopRequestedError(path.join(stoppedFixture.dataDir, "STOP"))
    );
    const stopped = await stoppedFixture.service.execute({
      operation: "save-drafts",
      blogs: [blog("blog-1")],
      items: [
        { blogKey: "blog-1", article: article("one") },
        { blogKey: "blog-1", article: article("two") }
      ]
    });
    expect(stopped.items.map((item) => item.status)).toEqual(["FAILED", "SKIPPED"]);
    expect(stopped.items[1].error).toContain("STOP");
  });

  it("requires safe flags and scheduled timestamps for schedule batches", async () => {
    const draftFixture = fixture({ draftEnabled: false });
    await expect(
      draftFixture.service.execute({
        operation: "save-drafts",
        blogs: [blog("blog-1")],
        items: [{ blogKey: "blog-1", article: article("one") }]
      })
    ).rejects.toThrow("ENABLE_DRAFT_SAVE=true");

    await expect(
      draftFixture.service.execute({
        operation: "plan-schedules",
        blogs: [blog("blog-1")],
        items: [{ blogKey: "blog-1", article: article("one") }]
      })
    ).rejects.toThrow("scheduledAt");

    const planned = await draftFixture.service.execute({
      operation: "plan-schedules",
      blogs: [blog("blog-1")],
      items: [
        {
          blogKey: "blog-1",
          article: article("one", "2026-08-10T00:00:00.000Z")
        }
      ]
    });
    expect(planned.items[0]).toMatchObject({ status: "SUCCEEDED", jobId: "schedule-one" });
  });

  it("rejects dry-run batches when dry-run is disabled or a mutation flag is enabled", async () => {
    const manifest = {
      operation: "dry-run",
      blogs: [blog("blog-1")],
      items: [{ blogKey: "blog-1", article: article("one") }]
    };

    await expect(fixture().service.execute(manifest)).rejects.toThrow(
      "both mutation flags disabled"
    );
    await expect(
      fixture({ draftEnabled: false, dryRunEnabled: false }).service.execute(manifest)
    ).rejects.toThrow("ENABLE_DRY_RUN=true");
  });

  it("rejects the entire dry-run batch when a dedicated draft URL is missing", async () => {
    const unsafeBlog = blog("blog-1");
    delete (unsafeBlog as { blogger?: unknown }).blogger;
    const { service, dryRun } = fixture({ draftEnabled: false });

    await expect(
      service.execute({
        operation: "dry-run",
        blogs: [unsafeBlog],
        items: [{ blogKey: "blog-1", article: article("one") }]
      })
    ).rejects.toThrow("existing dedicated draft postEditorUrl");
    expect(dryRun).not.toHaveBeenCalled();
  });
});
