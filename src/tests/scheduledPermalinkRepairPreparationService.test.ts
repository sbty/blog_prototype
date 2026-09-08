import { describe, expect, it } from "vitest";
import type { ScheduledPermalinkAuditItem } from "../services/scheduledPermalinkAuditService.js";
import { ScheduledPermalinkRepairPreparationService } from "../services/scheduledPermalinkRepairPreparationService.js";

function pass(value: unknown) {
  return { status: "PASS" as const, expected: value, actual: value };
}

function item(overrides: Partial<ScheduledPermalinkAuditItem> = {}): ScheduledPermalinkAuditItem {
  return {
    batch: "next-operational-batch",
    blogKey: "pc-game-troubleshooting-jp-01",
    slug: "pc-game-troubleshooting-03",
    postId: "4444444444444444444",
    postEditorUrl: "https://www.blogger.com/blog/post/edit/3333333333333333333/4444444444444444444",
    expectedScheduledAtJst: "2026-09-14 09:00 JST",
    status: "FAIL",
    permalink: "EMPTY",
    checks: {
      blogId: pass("3333333333333333333"),
      postId: pass("4444444444444444444"),
      editorUrl: pass(
        "https://www.blogger.com/blog/post/edit/3333333333333333333/4444444444444444444"
      ),
      draftState: pass("SCHEDULED"),
      scheduled: pass(true),
      published: pass(false),
      title: pass("タイトル"),
      body: pass("本文"),
      officialLinks: pass([]),
      labels: pass(["label"]),
      searchDescription: pass("説明"),
      permalink: { status: "FAIL", expected: "pc-game-troubleshooting-03", actual: "" },
      imageCount: pass(1),
      scheduledAtJst: pass("2026-09-14 09:00 JST")
    },
    reasons: ["permalink: expected ..."],
    attempts: 1,
    auditedAt: "2026-09-03T00:00:00.000Z",
    ...overrides
  };
}

const source = {
  batch: "next-operational-batch",
  blogKey: "pc-game-troubleshooting-jp-01",
  slug: "pc-game-troubleshooting-03",
  postId: "4444444444444444444",
  postEditorUrl: "https://www.blogger.com/blog/post/edit/3333333333333333333/4444444444444444444",
  blogPath: "blogs/pc.json",
  articlePath: "articles/pc.json"
};

describe("ScheduledPermalinkRepairPreparationService", () => {
  it("creates an approval-only package and excludes unresolved differences", () => {
    const permalinkOnly = item();
    const difference = item({
      slug: "pc-game-troubleshooting-04",
      postId: "4444444444444444445",
      postEditorUrl:
        "https://www.blogger.com/blog/post/edit/3333333333333333333/4444444444444444445",
      checks: {
        ...permalinkOnly.checks,
        postId: pass("4444444444444444445"),
        editorUrl: pass(
          "https://www.blogger.com/blog/post/edit/3333333333333333333/4444444444444444445"
        ),
        body: { status: "FAIL", expected: "正本", actual: "別本文" },
        permalink: { status: "FAIL", expected: "pc-game-troubleshooting-04", actual: "" }
      }
    });
    const unverified = item({
      slug: "pc-game-troubleshooting-05",
      postId: "4444444444444444446",
      postEditorUrl:
        "https://www.blogger.com/blog/post/edit/3333333333333333333/4444444444444444446",
      status: "UNVERIFIED",
      permalink: "UNVERIFIED",
      checks: undefined,
      finalError: "net::ERR_CONNECTION_TIMED_OUT"
    });
    const report = new ScheduledPermalinkRepairPreparationService(
      () => new Date("2026-09-03T00:00:00.000Z")
    ).prepare({
      auditReportPath: "audit.json",
      selectionManifestPath: "selection.json",
      items: [permalinkOnly, difference, unverified],
      candidates: {
        PERMALINK_ONLY: [permalinkOnly],
        CANONICAL_DIFFERENCE: [difference],
        CONNECTION_UNVERIFIED: [unverified]
      },
      canonicalSources: [
        source,
        {
          ...source,
          slug: difference.slug,
          postId: difference.postId,
          postEditorUrl: difference.postEditorUrl
        },
        {
          ...source,
          slug: unverified.slug,
          postId: unverified.postId,
          postEditorUrl: unverified.postEditorUrl
        }
      ]
    });
    expect(report.counts).toEqual({
      totalAudited: 3,
      repairCandidates: 1,
      canonicalDifferenceExcluded: 1,
      connectionUnverifiedExcluded: 1,
      alreadyCompliant: 0
    });
    expect(report.repairManifest.targets[0]).toMatchObject({
      currentPermalink: "",
      slug: "pc-game-troubleshooting-03"
    });
    expect(report.exclusions.canonicalDifference[0].nonPermalinkDifferences).toEqual(["body"]);
    expect(report.exclusions.connectionUnverified[0].reason).toContain("TIMED_OUT");
  });

  it("rejects a candidate that has a non-permalink difference", () => {
    const valid = item();
    const invalid = item({
      checks: {
        ...valid.checks,
        body: { status: "FAIL", expected: "正本", actual: "別本文" }
      }
    });
    expect(() =>
      new ScheduledPermalinkRepairPreparationService().prepare({
        auditReportPath: "audit.json",
        selectionManifestPath: "selection.json",
        items: [invalid],
        candidates: {
          PERMALINK_ONLY: [invalid],
          CANONICAL_DIFFERENCE: [],
          CONNECTION_UNVERIFIED: []
        },
        canonicalSources: [source]
      })
    ).toThrow("not eligible");
  });

  it("rejects a permalink-only candidate with incomplete audit checks", () => {
    const invalid = item({
      checks: {
        permalink: { status: "FAIL", expected: "pc-game-troubleshooting-03", actual: "" }
      }
    });
    expect(() =>
      new ScheduledPermalinkRepairPreparationService().prepare({
        auditReportPath: "audit.json",
        selectionManifestPath: "selection.json",
        items: [invalid],
        candidates: {
          PERMALINK_ONLY: [invalid],
          CANONICAL_DIFFERENCE: [],
          CONNECTION_UNVERIFIED: []
        },
        canonicalSources: [source]
      })
    ).toThrow("missing required checks");
  });

  it("rejects a candidate that does not exactly match its audit item", () => {
    const audited = item();
    const tampered = { ...audited, attempts: 2 };
    expect(() =>
      new ScheduledPermalinkRepairPreparationService().prepare({
        auditReportPath: "audit.json",
        selectionManifestPath: "selection.json",
        items: [audited],
        candidates: {
          PERMALINK_ONLY: [tampered],
          CANONICAL_DIFFERENCE: [],
          CONNECTION_UNVERIFIED: []
        },
        canonicalSources: [source]
      })
    ).toThrow("does not match audit item");
  });

  it("rejects an omitted failed audit item from candidate classification", () => {
    const audited = item();
    expect(() =>
      new ScheduledPermalinkRepairPreparationService().prepare({
        auditReportPath: "audit.json",
        selectionManifestPath: "selection.json",
        items: [audited],
        candidates: {
          PERMALINK_ONLY: [],
          CANONICAL_DIFFERENCE: [],
          CONNECTION_UNVERIFIED: []
        },
        canonicalSources: [source]
      })
    ).toThrow("classification is incomplete");
  });

  it("keeps a different non-empty permalink out of the repair manifest", () => {
    const valid = item();
    const different = item({
      permalink: "DIFFERENT",
      checks: {
        ...valid.checks,
        permalink: {
          status: "FAIL",
          expected: "pc-game-troubleshooting-03",
          actual: "different-slug"
        }
      }
    });
    const report = new ScheduledPermalinkRepairPreparationService().prepare({
      auditReportPath: "audit.json",
      selectionManifestPath: "selection.json",
      items: [different],
      candidates: {
        PERMALINK_ONLY: [],
        CANONICAL_DIFFERENCE: [different],
        CONNECTION_UNVERIFIED: []
      },
      canonicalSources: [source]
    });
    expect(report.repairManifest.targets).toEqual([]);
    expect(report.exclusions.canonicalDifference).toHaveLength(1);
  });
});
