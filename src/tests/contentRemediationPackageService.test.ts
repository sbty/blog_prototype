import { describe, expect, it } from "vitest";
import {
  contentRemediationPackageSchema,
  ContentRemediationPackageService
} from "../services/contentRemediationPackageService.js";

const sourceUrl = "https://example.com/official-source";

function batch() {
  return {
    operation: "save-drafts",
    blogs: [
      {
        blogKey: "one",
        displayName: "One",
        adminUrl: "https://www.blogger.com/blog/posts/1111111111",
        primaryTheme: "First topic",
        targetLength: { min: 10, max: 5000 }
      },
      {
        blogKey: "two",
        displayName: "Two",
        adminUrl: "https://www.blogger.com/blog/posts/2222222222",
        language: "ja",
        targetCountry: "JP",
        primaryTheme: "Second topic",
        targetAudience: ["Readers"],
        topicClusters: ["Guides"],
        excludedTopics: ["Unsafe advice"],
        targetLength: { min: 1000, max: 3000 },
        blogger: {
          postEditorUrl: "https://www.blogger.com/blog/post/edit/2222222222/3333333333"
        }
      }
    ],
    items: [
      {
        blogKey: "one",
        article: {
          title: "Passing",
          html: "<h2>Passing</h2><p>Body</p>",
          labels: ["pass"],
          searchDescription: "Passing",
          slug: "passing"
        }
      },
      {
        blogKey: "two",
        article: {
          title: "Needs correction",
          html: `<h2>Current</h2><p>Short <a href="${sourceUrl}">source</a>.</p>`,
          labels: ["guide"],
          searchDescription: "Needs correction",
          slug: "needs-correction",
          imagePath: "C:\\private\\generated-image.png",
          scheduledAt: "2026-08-20T00:00:00.000Z"
        },
        provenance: {
          generationRequestId: "request-two",
          sourceUrls: [sourceUrl]
        }
      }
    ]
  };
}

function metrics(textLength: number) {
  return {
    textLength,
    targetLengthMin: 10,
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
    counts: { total: 2, passed: 1, failed: 1, errors: 1, warnings: 0 },
    items: [
      {
        index: 0,
        blogKey: "one",
        slug: "passing",
        status: "PASS",
        metrics: metrics(100),
        issues: []
      },
      {
        index: 1,
        blogKey: "two",
        slug: "needs-correction",
        status: "FAIL",
        metrics: { ...metrics(20), targetLengthMin: 1000, targetLengthMax: 3000 },
        issues: [
          {
            code: "TARGET_LENGTH",
            severity: "ERROR",
            message: "Article is too short"
          }
        ]
      }
    ]
  };
}

describe("ContentRemediationPackageService", () => {
  it("exports only failed content and strips Blogger identity and out-of-band fields", () => {
    const result = new ContentRemediationPackageService().execute(batch(), audit());
    const request = result.requests[0];
    const serialized = JSON.stringify(result);

    expect(contentRemediationPackageSchema.parse(result)).toEqual(result);
    expect(result.requests).toHaveLength(1);
    expect(request).toMatchObject({
      remediationId: "content-remediation-0002",
      sourceIndex: 1,
      blogKey: "two",
      editorialProfile: {
        displayName: "Two",
        language: "ja",
        targetCountry: "JP",
        targetLength: { min: 1000, max: 3000 }
      },
      currentArticle: { slug: "needs-correction" },
      provenance: { sourceUrls: [sourceUrl], requiresSourceResearch: false },
      audit: { issues: [expect.objectContaining({ code: "TARGET_LENGTH" })] }
    });
    expect(request.currentArticle).not.toHaveProperty("imagePath");
    expect(request.currentArticle).not.toHaveProperty("scheduledAt");
    expect(serialized).not.toContain("1111111111");
    expect(serialized).not.toContain("2222222222");
    expect(serialized).not.toContain("generated-image.png");
    expect(serialized).not.toContain("blogger.com/blog");
  });

  it("marks missing provenance as requiring source research", () => {
    const input = batch();
    delete (input.items[1] as { provenance?: unknown }).provenance;
    const result = new ContentRemediationPackageService().execute(input, audit());
    expect(result.requests[0].provenance).toEqual({
      sourceUrls: [],
      requiresSourceResearch: true
    });
  });

  it("rejects an audit that does not match the source batch", () => {
    const report = audit();
    report.items[1].slug = "wrong";
    expect(() => new ContentRemediationPackageService().execute(batch(), report)).toThrow(
      "Content audit item does not match source batch index 1"
    );
  });
});
