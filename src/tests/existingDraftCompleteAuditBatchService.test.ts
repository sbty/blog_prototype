import { describe, expect, it, vi } from "vitest";
import type { BlogConfig } from "../config/blogConfig.js";
import { existingDraftAuditBatchManifestSchema } from "../domain/existingDraftAuditBatch.js";
import { loadConfig } from "../config/env.js";
import type { ArticleInput } from "../domain/article.js";
import type { ExistingDraftCompleteAuditReport } from "../services/existingDraftCompleteAuditService.js";
import {
  ExistingDraftCompleteAuditBatchService,
  summarizeExistingDraftCompleteAuditBatch,
  type ExistingDraftCompleteAuditBatchItemInput
} from "../services/existingDraftCompleteAuditBatchService.js";

function article(slug: string): ArticleInput {
  return {
    title: `記事 ${slug}`,
    html: "<p>本文</p>",
    labels: ["test"],
    searchDescription: "説明",
    slug,
    imagePath: "C:/image.png"
  };
}

function item(index: number): ExistingDraftCompleteAuditBatchItemInput {
  const blogId = String(1111111111 + index);
  const postId = String(2222222222 + index);
  const slug = `draft-${index}`;
  return {
    blogPath: `blogs/${slug}.json`,
    articlePath: `articles/${slug}.json`,
    postId,
    postEditorUrl: `https://www.blogger.com/blog/post/edit/${blogId}/${postId}`,
    slug,
    blog: {
      blogKey: `blog-${index}`,
      displayName: `Blog ${index}`,
      adminUrl: `https://www.blogger.com/blog/posts/${blogId}`,
      primaryTheme: "test",
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
    } as BlogConfig,
    article: article(slug)
  };
}

function report(
  item: ExistingDraftCompleteAuditBatchItemInput,
  status: "PASS" | "FAIL" | "UNVERIFIED"
) {
  return {
    schemaVersion: 1,
    auditType: "read-only-existing-draft-complete-audit",
    status,
    auditedAt: "2026-09-01T00:00:00.000Z",
    target: {
      blogKey: item.blog.blogKey,
      expectedPostId: item.postId,
      expectedEditUrl: item.postEditorUrl
    },
    actual: {},
    duplicateTitleAudit: { title: item.article.title, editUrls: [item.postEditorUrl], count: 1 },
    checks: {},
    reasons:
      status === "PASS"
        ? []
        : status === "FAIL"
          ? ["body: expected local article, actual different article"]
          : ["Blogger draft state could not be verified"]
  } as unknown as ExistingDraftCompleteAuditReport;
}

describe("ExistingDraftCompleteAuditBatchService", () => {
  it("audits valid items sequentially and aggregates successful reports", async () => {
    const inputs = [item(1), item(2)];
    const calls: string[] = [];
    const service = new ExistingDraftCompleteAuditBatchService(
      loadConfig({}),
      () => new Date("2026-09-01T00:00:00.000Z"),
      () => ({
        execute: async (input) => {
          calls.push(input.postId);
          return report(
            inputs.find((candidate) => candidate.postId === input.postId)!,
            "PASS"
          );
        }
      })
    );

    const result = await service.execute({ items: inputs });

    expect(calls).toEqual(inputs.map((candidate) => candidate.postId));
    expect(result).toMatchObject({ status: "PASS", counts: { total: 2, pass: 2, fail: 0 } });
  });

  it("continues after one item fails and keeps its reason", async () => {
    const inputs = [item(1), item(2)];
    let invocation = 0;
    const service = new ExistingDraftCompleteAuditBatchService(
      loadConfig({}),
      () => new Date("2026-09-01T00:00:00.000Z"),
      () => ({
        execute: async (input) =>
          report(
            input as ExistingDraftCompleteAuditBatchItemInput,
            invocation++ === 0 ? "FAIL" : "PASS"
          )
      })
    );

    const result = await service.execute({ items: inputs });

    expect(result).toMatchObject({ status: "FAIL", counts: { total: 2, pass: 1, fail: 1 } });
    expect(result.items[0].reasons).toContain(
      "body: expected local article, actual different article"
    );
    expect(result.items[1].status).toBe("PASS");
  });

  it("fails preflight before opening Blogger for duplicate post IDs", async () => {
    const first = item(1);
    const second = { ...item(2), postId: first.postId };
    const execute = vi.fn();
    const service = new ExistingDraftCompleteAuditBatchService(loadConfig({}), undefined, () => ({
      execute
    }));

    await expect(service.execute({ items: [first, second] })).rejects.toThrow("Duplicate postId");
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails preflight when an editor URL belongs to another blog", async () => {
    const invalid = {
      ...item(1),
      postEditorUrl: "https://www.blogger.com/blog/post/edit/9999999999/2222222223"
    };
    const service = new ExistingDraftCompleteAuditBatchService(loadConfig({}));

    await expect(service.execute({ items: [invalid] })).rejects.toThrow(
      "Editor URL does not belong to configured blog"
    );
  });

  it("keeps an unreadable item UNVERIFIED and continues the batch", async () => {
    const inputs = [item(1), item(2)];
    let invocation = 0;
    const service = new ExistingDraftCompleteAuditBatchService(
      loadConfig({}),
      () => new Date("2026-09-01T00:00:00.000Z"),
      () => ({
        execute: async (input) => {
          invocation += 1;
          if (invocation === 1) throw new Error("net::ERR_CONNECTION_TIMED_OUT");
          return report(input as ExistingDraftCompleteAuditBatchItemInput, "PASS");
        }
      })
    );

    const result = await service.execute({ items: inputs });

    expect(result).toMatchObject({
      status: "UNVERIFIED",
      counts: { total: 2, pass: 1, fail: 0, unverified: 1 }
    });
    expect(result.items[0]).toMatchObject({
      status: "UNVERIFIED",
      reasons: ["net::ERR_CONNECTION_TIMED_OUT"]
    });
    expect(result.items[1].status).toBe("PASS");
  });

  it("creates a compact summary that references details without embedding full reports", async () => {
    const inputs = [item(1)];
    const service = new ExistingDraftCompleteAuditBatchService(
      loadConfig({}),
      () => new Date("2026-09-01T00:00:00.000Z"),
      () => ({
        execute: async (input) => report(input as ExistingDraftCompleteAuditBatchItemInput, "PASS")
      })
    );
    const result = await service.execute({ items: inputs });

    const summary = summarizeExistingDraftCompleteAuditBatch(
      result,
      (candidate) => `${candidate.index + 1}-${candidate.slug}.json`
    );

    expect(summary.items[0]).toEqual({
      index: 0,
      slug: inputs[0].slug,
      blogKey: inputs[0].blog.blogKey,
      postId: inputs[0].postId,
      status: "PASS",
      auditedAt: "2026-09-01T00:00:00.000Z",
      reasons: [],
      detailFile: `1-${inputs[0].slug}.json`
    });
    expect(JSON.stringify(summary)).not.toContain("postEditorUrl");
    expect(JSON.stringify(summary)).not.toContain('"report"');
  });
});

describe("existingDraftAuditBatchManifestSchema", () => {
  const entry = {
    blogPath: "blog.json",
    articlePath: "article.json",
    postId: "2222222222",
    postEditorUrl: "https://www.blogger.com/blog/post/edit/1111111111/2222222222",
    slug: "draft-1"
  };

  it("rejects duplicate post IDs and duplicate editor URLs before loading Blogger", () => {
    expect(() =>
      existingDraftAuditBatchManifestSchema.parse({
        schemaVersion: 1,
        operation: "audit-existing-drafts",
        items: [entry, { ...entry, slug: "draft-2" }]
      })
    ).toThrow("Duplicate postId");
    expect(() =>
      existingDraftAuditBatchManifestSchema.parse({
        schemaVersion: 1,
        operation: "audit-existing-drafts",
        items: [entry, { ...entry, postId: "3333333333", slug: "draft-2" }]
      })
    ).toThrow("Duplicate postEditorUrl");
  });
});
