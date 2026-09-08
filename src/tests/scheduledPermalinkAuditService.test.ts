import { describe, expect, it, vi } from "vitest";
import type { BlogConfig } from "../config/blogConfig.js";
import type { ArticleInput } from "../domain/article.js";
import type { ExistingDraftInspection } from "../browser/bloggerDryRun.js";
import {
  buildScheduledPermalinkReauditRepairReport,
  ScheduledPermalinkAuditService,
  type ScheduledPermalinkAuditTarget
} from "../services/scheduledPermalinkAuditService.js";

const postId = "2222222222222222222";
const blog = {
  blogKey: "desk-gear-lab-jp-01",
  adminUrl: "https://www.blogger.com/blog/posts/1111111111111111111"
} as BlogConfig;
const article = {
  title: "キーボードトレーは必要？",
  html: '<p>本文</p><a href="https://www.osha.gov/example">OSHA</a>',
  labels: ["キーボードトレー"],
  searchDescription: "説明",
  slug: "desk-gear-lab-02",
  imagePath: "C:/images/desk-gear-lab-02.png"
} as ArticleInput;
const target: ScheduledPermalinkAuditTarget = {
  batch: "initial-operational-batch",
  blog,
  article,
  postId,
  postEditorUrl: `https://www.blogger.com/blog/post/edit/1111111111111111111/${postId}`,
  scheduledAtJst: "2026-09-02 15:00 JST"
};

function inspection(overrides: Partial<ExistingDraftInspection> = {}): ExistingDraftInspection {
  return {
    blogId: "1111111111111111111",
    postId,
    editUrl: target.postEditorUrl,
    postState: "SCHEDULED",
    scheduledDate: "2026/09/02",
    scheduledTime: "15:00",
    title: article.title,
    html: article.html,
    labels: article.labels,
    searchDescription: article.searchDescription,
    slug: article.slug,
    imageCount: 1,
    ...overrides
  };
}

function service(result: () => Promise<ExistingDraftInspection>) {
  return new ScheduledPermalinkAuditService(
    async () => ({ inspectExistingDraft: result }),
    () => new Date("2026-09-01T00:00:00.000Z"),
    2
  );
}

describe("ScheduledPermalinkAuditService", () => {
  it("passes an exact scheduled post and reports a matching permalink", async () => {
    const report = await service(async () => inspection()).execute([target]);
    expect(report.counts).toEqual({ total: 1, pass: 1, fail: 0, unverified: 0 });
    expect(report.items[0]).toMatchObject({ status: "PASS", permalink: "MATCH" });
  });

  it("reports an empty permalink as a separate failure", async () => {
    const report = await service(async () => inspection({ slug: "" })).execute([target]);
    expect(report.items[0]).toMatchObject({ status: "FAIL", permalink: "EMPTY" });
    expect(report.permalinkIssues).toHaveLength(1);
  });

  it.each([
    ["different permalink", { slug: "other-slug" }],
    ["published post", { postState: "PUBLISHED" as const }],
    ["schedule mismatch", { scheduledTime: "16:00" }],
    ["missing image", { imageCount: 0 }],
    ["body mismatch", { html: "<p>別の本文</p>" }]
  ])("fails %s", async (_name, override) => {
    const report = await service(async () => inspection(override)).execute([target]);
    expect(report.items[0].status).toBe("FAIL");
  });

  it("retries transient read failures and records an unverified post when they persist", async () => {
    const inspectExistingDraft = vi.fn(async () => {
      throw new Error("net::ERR_CONNECTION_TIMED_OUT");
    });
    const report = await service(inspectExistingDraft).execute([target]);
    expect(inspectExistingDraft).toHaveBeenCalledTimes(2);
    expect(report.items[0]).toMatchObject({
      status: "UNVERIFIED",
      permalink: "UNVERIFIED",
      attempts: 2
    });
  });

  it("rejects duplicate target post IDs before any browser inspection", async () => {
    const inspectExistingDraft = vi.fn(async () => inspection());
    await expect(service(inspectExistingDraft).execute([target, { ...target }])).rejects.toThrow(
      "Duplicate scheduled audit post ID"
    );
    expect(inspectExistingDraft).not.toHaveBeenCalled();
  });

  it("rejects an editor URL post-ID mismatch before any browser inspection", async () => {
    const inspectExistingDraft = vi.fn(async () => inspection());
    await expect(
      service(inspectExistingDraft).execute([
        {
          ...target,
          postEditorUrl:
            "https://www.blogger.com/blog/post/edit/1111111111111111111/3333333333333333333"
        }
      ])
    ).rejects.toThrow("editor URL post ID mismatch");
    expect(inspectExistingDraft).not.toHaveBeenCalled();
  });

  it("rejects an unbounded concurrency setting before any browser inspection", async () => {
    const inspectExistingDraft = vi.fn(async () => inspection());
    const invalid = new ScheduledPermalinkAuditService(
      async () => ({ inspectExistingDraft }),
      undefined,
      2,
      0
    );
    await expect(invalid.execute([target])).rejects.toThrow("maxConcurrency");
    expect(inspectExistingDraft).not.toHaveBeenCalled();
  });

  it("keeps mismatch reasons compact", async () => {
    const report = await service(async () => inspection({ html: "<p>別の本文</p>" })).execute([
      target
    ]);
    expect(report.items[0].reasons).toContain("body: expected and actual values differ");
    expect(report.items[0].reasons.join(" ")).not.toContain(article.html);
  });

  it("integrates re-audited items and separates permalink-only, source-difference, and connection candidates", async () => {
    const emptyPermalink = (await service(async () => inspection({ slug: "" })).execute([target]))
      .items[0];
    const differentTarget = {
      ...target,
      postId: "2222222222222222224",
      postEditorUrl:
        "https://www.blogger.com/blog/post/edit/1111111111111111111/2222222222222222224"
    };
    const sourceDifference = (
      await service(async () =>
        inspection({
          postId: differentTarget.postId,
          editUrl: differentTarget.postEditorUrl,
          html: "<p>別の本文</p>"
        })
      ).execute([differentTarget])
    ).items[0];
    const reauditedTarget = {
      ...target,
      postId: "2222222222222222223",
      postEditorUrl:
        "https://www.blogger.com/blog/post/edit/1111111111111111111/2222222222222222223"
    };
    const unverified = (
      await service(async () => {
        throw new Error("net::ERR_CONNECTION_TIMED_OUT");
      }).execute([reauditedTarget])
    ).items[0];
    const reauditedPass = (
      await service(async () =>
        inspection({ postId: reauditedTarget.postId, editUrl: reauditedTarget.postEditorUrl })
      ).execute([reauditedTarget])
    ).items[0];
    const report = buildScheduledPermalinkReauditRepairReport({
      priorReportPath: "previous.json",
      priorItems: [emptyPermalink, sourceDifference, unverified],
      reauditedItems: [reauditedPass],
      now: () => new Date("2026-09-02T00:00:00.000Z")
    });
    expect(report.counts).toEqual({ total: 3, pass: 1, fail: 2, unverified: 0 });
    expect(report.candidates.PERMALINK_ONLY).toHaveLength(1);
    expect(report.candidates.CANONICAL_DIFFERENCE).toHaveLength(1);
    expect(report.candidates.CONNECTION_UNVERIFIED).toHaveLength(0);
  });

  it("classifies a different non-empty permalink as a canonical difference", async () => {
    const different = (
      await service(async () => inspection({ slug: "different-slug" })).execute([target])
    ).items[0];
    const report = buildScheduledPermalinkReauditRepairReport({
      priorReportPath: "previous.json",
      priorItems: [different],
      reauditedItems: []
    });
    expect(report.candidates.PERMALINK_ONLY).toEqual([]);
    expect(report.candidates.CANONICAL_DIFFERENCE).toEqual([different]);
  });

  it("rejects a re-audited post that was absent from the prior report", async () => {
    const unverified = (
      await service(async () => {
        throw new Error("net::ERR_CONNECTION_TIMED_OUT");
      }).execute([target])
    ).items[0];
    const otherTarget = {
      ...target,
      postId: "2222222222222222223",
      postEditorUrl:
        "https://www.blogger.com/blog/post/edit/1111111111111111111/2222222222222222223"
    };
    const otherPass = (
      await service(async () =>
        inspection({ postId: otherTarget.postId, editUrl: otherTarget.postEditorUrl })
      ).execute([otherTarget])
    ).items[0];
    expect(() =>
      buildScheduledPermalinkReauditRepairReport({
        priorReportPath: "previous.json",
        priorItems: [unverified],
        reauditedItems: [otherPass]
      })
    ).toThrow("absent from the prior report");
  });

  it("rejects identity drift while replacing an UNVERIFIED prior item", async () => {
    const unverified = (
      await service(async () => {
        throw new Error("net::ERR_CONNECTION_TIMED_OUT");
      }).execute([target])
    ).items[0];
    const pass = (await service(async () => inspection()).execute([target])).items[0];
    const changedSchedule = "2026-09-02 16:00 JST";
    expect(() =>
      buildScheduledPermalinkReauditRepairReport({
        priorReportPath: "previous.json",
        priorItems: [unverified],
        reauditedItems: [
          {
            ...pass,
            expectedScheduledAtJst: changedSchedule,
            checks: {
              ...pass.checks,
              scheduledAtJst: { status: "PASS", expected: changedSchedule, actual: changedSchedule }
            }
          }
        ]
      })
    ).toThrow("identity changed");
  });
});
