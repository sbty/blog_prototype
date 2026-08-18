import { describe, expect, it } from "vitest";
import { ContentAuditRetryService } from "../services/contentAuditRetryService.js";

function blog(blogKey: string, id: string) {
  return {
    blogKey,
    displayName: blogKey,
    adminUrl: `https://www.blogger.com/blog/posts/${id}`,
    primaryTheme: "Technical guides",
    targetLength: { min: 1, max: 5000 },
    blogger: {
      postEditorUrl: `https://www.blogger.com/blog/post/edit/${id}/3333333333`
    }
  };
}

function article(slug: string) {
  return {
    title: slug,
    html: `<h2>${slug}</h2><p>Body</p>`,
    labels: ["guide"],
    searchDescription: slug,
    slug
  };
}

function batch() {
  return {
    operation: "save-drafts",
    continueOnError: true,
    blogs: [blog("one", "1111111111"), blog("two", "2222222222")],
    items: [
      { blogKey: "one", article: article("alpha") },
      { blogKey: "two", article: article("beta") },
      { blogKey: "one", article: article("gamma") }
    ]
  };
}

function metrics() {
  return {
    textLength: 100,
    targetLengthMin: 1,
    targetLengthMax: 5000,
    sourceCount: 1,
    citedSourceCount: 1,
    labelCount: 1,
    imageBytes: 100
  };
}

function audit() {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-18T00:00:00.000Z",
    status: "FAIL",
    counts: { total: 3, passed: 2, failed: 1, errors: 1, warnings: 0 },
    items: [
      {
        index: 0,
        blogKey: "one",
        slug: "alpha",
        status: "PASS",
        metrics: metrics(),
        issues: []
      },
      {
        index: 1,
        blogKey: "two",
        slug: "beta",
        status: "FAIL",
        metrics: metrics(),
        issues: [
          {
            code: "PROVENANCE_MISSING",
            severity: "ERROR",
            message: "Missing provenance"
          }
        ]
      },
      {
        index: 2,
        blogKey: "one",
        slug: "gamma",
        status: "PASS",
        metrics: metrics(),
        issues: []
      }
    ]
  };
}

describe("ContentAuditRetryService", () => {
  it("creates a save-drafts retry containing only failed items and their blogs", () => {
    const result = new ContentAuditRetryService().execute(batch(), audit());

    expect(result.manifest.operation).toBe("save-drafts");
    expect(result.manifest.blogs.map((item) => item.blogKey)).toEqual(["two"]);
    expect(result.manifest.items.map((item) => item.article.slug)).toEqual(["beta"]);
    expect(result.failedAssignments).toEqual([
      {
        index: 1,
        blogKey: "two",
        slug: "beta",
        issueCodes: ["PROVENANCE_MISSING"]
      }
    ]);
  });

  it("rejects an audit whose item identity does not exactly match the source batch", () => {
    const report = audit();
    report.items[1].slug = "different";
    expect(() => new ContentAuditRetryService().execute(batch(), report)).toThrow(
      "Content audit item does not match source batch index 1"
    );
  });

  it("rejects inconsistent audit counts", () => {
    const report = audit();
    report.counts.failed = 2;
    expect(() => new ContentAuditRetryService().execute(batch(), report)).toThrow(
      "Content audit counts are inconsistent"
    );
  });

  it("rejects a passing audit and a non-save source batch", () => {
    const passing = audit();
    passing.items[1].status = "PASS";
    passing.items[1].issues = [];
    passing.status = "PASS";
    passing.counts = { total: 3, passed: 3, failed: 0, errors: 0, warnings: 0 };
    expect(() => new ContentAuditRetryService().execute(batch(), passing)).toThrow(
      "A passing content audit does not need a retry batch"
    );

    const source = batch();
    source.operation = "dry-run";
    expect(() => new ContentAuditRetryService().execute(source, audit())).toThrow(
      "Content audit retry requires a save-drafts batch"
    );
  });
});
