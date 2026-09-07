import { describe, expect, it } from "vitest";
import type { ArticleInput } from "../domain/article.js";
import type { BlogConfig } from "../config/blogConfig.js";
import type { PublishedPostCompleteAuditReport } from "../services/publishedPostCompleteAuditService.js";
import {
  PublicationMonitorBatchService,
  type PublicationMonitorCanonicalItem,
  type PublicationMonitorSource
} from "../services/publicationMonitorBatchService.js";

const blog = {
  blogKey: "blog-1",
  displayName: "Blog 1",
  adminUrl: "https://www.blogger.com/blog/posts/1111111111",
  publicUrl: "https://blog-1.example/",
  primaryTheme: "test",
  language: "ja",
  targetCountry: "JP",
  targetAudience: [],
  topicClusters: [],
  excludedTopics: [],
  contentPolicy: {
    evergreenRatio: 0.5,
    durableExplainerRatio: 0.3,
    seasonalRatio: 0.1,
    newsRatio: 0.1
  },
  targetLength: { min: 3000, max: 5000 },
  dailyPostLimit: 1,
  blogger: { selectorsPath: "./config/blogger-selectors.json" }
} as BlogConfig;
const article = {
  title: "公開監査テスト",
  html: "<p>本文</p>",
  labels: ["test"],
  searchDescription: "説明",
  slug: "publication-monitor-test",
  imagePath: "image.png"
} as ArticleInput;
const canonical: PublicationMonitorCanonicalItem = {
  batch: "batch-1",
  slug: article.slug,
  blog,
  article,
  postId: "2222222222",
  postEditorUrl: "https://www.blogger.com/blog/post/edit/1111111111/2222222222"
};

function monitor(
  status: "PENDING" | "PASS" | "FAIL" | "UNVERIFIED" = "PENDING",
  scheduledAtJst = "2026-09-01 09:00 JST"
): PublicationMonitorSource {
  return {
    batch: "batch-1",
    path: "data/monitor-1.json",
    monitor: {
      schemaVersion: 1,
      purpose: "test",
      status: "ACTIVE",
      timezone: "Asia/Tokyo",
      counts: { total: 1, pending: 1, pass: 0, fail: 0 },
      items: [
        {
          slug: article.slug,
          blogKey: blog.blogKey,
          postId: canonical.postId,
          scheduledAtJst,
          status
        }
      ]
    }
  };
}

function audit(status: "PASS" | "FAIL" = "PASS"): PublishedPostCompleteAuditReport {
  return {
    schemaVersion: 1,
    auditType: "read-only-published-post-complete-audit",
    status,
    auditedAt: "2026-09-01T01:00:00.000Z",
    actual: {
      blogId: "1111111111",
      postId: canonical.postId,
      editUrl: canonical.postEditorUrl,
      postState: "PUBLISHED",
      title: article.title,
      html: article.html,
      labels: article.labels,
      searchDescription: article.searchDescription,
      slug: article.slug,
      imageCount: 1
    },
    publicAudit: null,
    checks: {},
    reasons: status === "PASS" ? [] : ["published: expected PUBLISHED, actual SCHEDULED"]
  };
}

function service(
  auditImpl: (input: PublicationMonitorCanonicalItem) => Promise<PublishedPostCompleteAuditReport>,
  retryOptions = { maxAttempts: 2, retryDelayMs: 0 }
) {
  return new PublicationMonitorBatchService(
    { audit: auditImpl },
    () => new Date("2026-09-01T01:00:00.000Z"),
    retryOptions
  );
}

describe("PublicationMonitorBatchService", () => {
  it("audits a due pending publication and persists a PASS state", async () => {
    const result = await service(async () => audit()).execute({
      monitors: [monitor()],
      canonicalItems: [canonical]
    });
    expect(result.report.counts).toEqual({ total: 1, skipped: 0, pass: 1, fail: 0, unverified: 0 });
    expect(result.monitors[0].monitor.items[0]).toMatchObject({ status: "PASS", auditAttempts: 1 });
  });

  it("leaves a post pending when it is less than thirty minutes past its scheduled time", async () => {
    const result = await service(async () => audit()).execute({
      monitors: [monitor("PENDING", "2026-09-01 09:45 JST")],
      canonicalItems: [canonical]
    });
    expect(result.report.decisions[0]).toMatchObject({ decision: "SKIPPED", attempts: 0 });
    expect(result.monitors[0].monitor.items[0].status).toBe("PENDING");
  });

  it("records a content mismatch as FAIL", async () => {
    const result = await service(async () => audit("FAIL")).execute({
      monitors: [monitor()],
      canonicalItems: [canonical]
    });
    expect(result.report.decisions[0]).toMatchObject({ decision: "FAIL", attempts: 1 });
    expect(result.monitors[0].monitor.items[0].status).toBe("FAIL");
  });

  it("retries a transient connection error before recording PASS", async () => {
    let calls = 0;
    const result = await service(async () => {
      calls += 1;
      if (calls === 1) throw new Error("net::ERR_CONNECTION_TIMED_OUT");
      return audit();
    }).execute({ monitors: [monitor()], canonicalItems: [canonical] });
    expect(result.report.decisions[0]).toMatchObject({ decision: "PASS", attempts: 2 });
  });

  it("records an exhausted timeout as UNVERIFIED rather than FAIL", async () => {
    const result = await service(async () => {
      throw new Error("net::ERR_CONNECTION_TIMED_OUT");
    }).execute({ monitors: [monitor()], canonicalItems: [canonical] });
    expect(result.report.decisions[0]).toMatchObject({
      decision: "UNVERIFIED",
      attempts: 2,
      finalError: "net::ERR_CONNECTION_TIMED_OUT"
    });
    expect(result.monitors[0].monitor.items[0].status).toBe("UNVERIFIED");
  });

  it("retries an UNVERIFIED item only when explicitly requested", async () => {
    const unchanged = await service(async () => audit()).execute({
      monitors: [monitor("UNVERIFIED")],
      canonicalItems: [canonical]
    });
    expect(unchanged.report.counts.total).toBe(0);
    const retried = await service(async () => audit()).execute({
      monitors: [monitor("UNVERIFIED")],
      canonicalItems: [canonical],
      retryUnverified: true
    });
    expect(retried.report.decisions[0]).toMatchObject({ decision: "PASS", attempts: 1 });
  });

  it("continues across multiple monitor files", async () => {
    const secondCanonical = {
      ...canonical,
      batch: "batch-2",
      slug: "publication-monitor-test-2",
      postId: "3333333333",
      postEditorUrl: "https://www.blogger.com/blog/post/edit/1111111111/3333333333",
      article: { ...article, slug: "publication-monitor-test-2", title: "公開監査テスト2" }
    };
    const secondMonitor = {
      ...monitor(),
      batch: "batch-2",
      path: "data/monitor-2.json",
      monitor: {
        ...monitor().monitor,
        items: [
          {
            ...monitor().monitor.items[0],
            slug: secondCanonical.slug,
            postId: secondCanonical.postId
          }
        ]
      }
    };
    const result = await service(async (input) =>
      input.postId === canonical.postId ? audit() : audit("FAIL")
    ).execute({
      monitors: [monitor(), secondMonitor],
      canonicalItems: [canonical, secondCanonical]
    });
    expect(result.report.counts).toEqual({ total: 2, skipped: 0, pass: 1, fail: 1, unverified: 0 });
  });

  it("fails preflight for duplicate monitor post IDs", () => {
    const duplicate = { ...monitor(), batch: "batch-2", path: "data/monitor-2.json" };
    expect(() =>
      service(async () => audit()).validatePreflight({
        monitors: [monitor(), duplicate],
        canonicalItems: [canonical]
      })
    ).toThrow("Duplicate monitor postId");
  });

  it("fails preflight when the local canonical post ID differs", () => {
    const wrongCanonical = { ...canonical, postId: "3333333333" };
    expect(() =>
      service(async () => audit()).validatePreflight({
        monitors: [monitor()],
        canonicalItems: [wrongCanonical]
      })
    ).toThrow("does not match local canonical");
  });
});
