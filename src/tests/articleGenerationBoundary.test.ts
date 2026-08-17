import { describe, expect, it } from "vitest";
import { ArticleGenerationPackageService } from "../services/articleGenerationPackageService.js";
import { GeneratedArticleImportService } from "../services/generatedArticleImportService.js";
import { GeneratedArticleBatchCompilerService } from "../services/generatedArticleBatchCompilerService.js";

function plan(overrides: Record<string, unknown> = {}) {
  return {
    targetOperation: "save-drafts",
    blogs: [
      {
        blogKey: "compatibility",
        displayName: "Compatibility",
        adminUrl: "https://www.blogger.com/blog/posts/1234567890123456789",
        publicUrl: "https://private-blog.example.invalid/",
        language: "en",
        targetCountry: "US",
        primaryTheme: "Device compatibility",
        targetAudience: ["Buyers"],
        topicClusters: ["USB-C and USB PD"],
        excludedTopics: ["unsafe electrical modifications"],
        targetLength: { min: 1800, max: 3500 },
        blogger: {
          selectorsPath: "./private-selectors.json",
          postEditorUrl:
            "https://www.blogger.com/blog/post/edit/1234567890123456789/1111111111111111111"
        }
      }
    ],
    requests: [
      {
        requestId: "request-one",
        blogKey: "compatibility",
        slug: "usb-c-compatibility",
        topic: "USB-C compatibility",
        searchIntent: "Check compatibility before purchase",
        routingTopics: ["USB-C and USB PD"],
        requiredPoints: ["Explain power negotiation"],
        sourceUrls: ["https://example.com/source-a", "https://example.org/source-b"]
      }
    ],
    ...overrides
  };
}

function responses(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    items: [
      {
        requestId: "request-one",
        article: {
          title: "USB-C compatibility",
          html: "<p>Check the official specifications.</p>",
          labels: ["USB-C"],
          searchDescription: "How to check USB-C compatibility.",
          slug: "usb-c-compatibility"
        },
        sourceUrlsUsed: ["https://example.org/source-b", "https://example.com/source-a"]
      }
    ],
    ...overrides
  };
}

describe("ArticleGenerationPackageService", () => {
  it("exports a provider-neutral editorial package without Blogger URLs", () => {
    const result = new ArticleGenerationPackageService().execute(plan());

    expect(result.package.schemaVersion).toBe(1);
    expect(result.package.requests[0]).toMatchObject({
      requestId: "request-one",
      editorialProfile: {
        blogKey: "compatibility",
        displayName: "Compatibility",
        language: "en",
        targetCountry: "US"
      },
      outputContract: { slug: "usb-c-compatibility" }
    });
    const serialized = JSON.stringify(result.package);
    expect(serialized).not.toContain("blogger.com");
    expect(serialized).not.toContain("private-blog");
    expect(serialized).not.toContain("private-selectors");
  });

  it("rejects unsafe sources, unknown blogs, and missing scheduled times", () => {
    const unsafe = plan();
    unsafe.requests[0].sourceUrls = ["http://example.com/source"];
    expect(() => new ArticleGenerationPackageService().execute(unsafe)).toThrow(
      "Source URL must use HTTPS"
    );

    const unknown = plan();
    unknown.requests[0].blogKey = "missing";
    expect(() => new ArticleGenerationPackageService().execute(unknown)).toThrow(
      "Unknown blogKey: missing"
    );

    expect(() =>
      new ArticleGenerationPackageService().execute(plan({ targetOperation: "plan-schedules" }))
    ).toThrow("Scheduled generation requests require scheduledAt");
  });

  it("rejects duplicate request IDs, slugs, and normalized source URLs", () => {
    const duplicateRequest = plan();
    duplicateRequest.requests.push({ ...duplicateRequest.requests[0] });
    expect(() => new ArticleGenerationPackageService().execute(duplicateRequest)).toThrow();

    const duplicateSource = plan();
    duplicateSource.requests[0].sourceUrls = [
      "https://example.com/source",
      "https://EXAMPLE.com/source"
    ];
    expect(() => new ArticleGenerationPackageService().execute(duplicateSource)).toThrow(
      "Source URLs must be unique"
    );
  });
});

describe("GeneratedArticleImportService", () => {
  it("imports one complete generated response into the local queue contract", () => {
    const queue = new GeneratedArticleImportService().execute(plan(), responses());

    expect(queue).toMatchObject({
      targetOperation: "save-drafts",
      items: [
        {
          article: { slug: "usb-c-compatibility" },
          routing: { blogKey: "compatibility", topics: ["USB-C and USB PD"] },
          provenance: {
            generationRequestId: "request-one",
            sourceUrls: ["https://example.org/source-b", "https://example.com/source-a"]
          }
        }
      ]
    });
  });

  it("requires exactly the planned response IDs", () => {
    expect(() =>
      new GeneratedArticleImportService().execute(plan(), { schemaVersion: 1, items: [] })
    ).toThrow();

    const unknown = responses();
    unknown.items[0].requestId = "unknown-request";
    expect(() => new GeneratedArticleImportService().execute(plan(), unknown)).toThrow(
      "unknown requestIds: unknown-request"
    );

    const duplicated = responses();
    duplicated.items.push({ ...duplicated.items[0] });
    expect(() => new GeneratedArticleImportService().execute(plan(), duplicated)).toThrow(
      "Duplicate generated requestId"
    );
  });

  it("rejects changed slugs and schedules", () => {
    const changedSlug = responses();
    changedSlug.items[0].article.slug = "changed-slug";
    expect(() => new GeneratedArticleImportService().execute(plan(), changedSlug)).toThrow(
      "changed the requested slug"
    );

    const changedSchedule = responses();
    (
      changedSchedule.items[0].article as (typeof changedSchedule.items)[0]["article"] & {
        scheduledAt?: string;
      }
    ).scheduledAt = "2026-08-20T09:00:00+09:00";
    expect(() => new GeneratedArticleImportService().execute(plan(), changedSchedule)).toThrow(
      "changed scheduledAt"
    );
  });

  it("requires an exact source attestation and strict safe article HTML", () => {
    const missingSource = responses();
    missingSource.items[0].sourceUrlsUsed = ["https://example.com/source-a"];
    expect(() => new GeneratedArticleImportService().execute(plan(), missingSource)).toThrow(
      "must attest to every planned source URL"
    );

    const activeHtml = responses();
    activeHtml.items[0].article.html = '<script src="https://example.com/x.js"></script>';
    expect(() => new GeneratedArticleImportService().execute(plan(), activeHtml)).toThrow(
      "Article HTML contains active content"
    );
  });
});

describe("GeneratedArticleBatchCompilerService", () => {
  it("validates, routes, and preserves source provenance in an executable batch manifest", () => {
    const result = new GeneratedArticleBatchCompilerService().execute(plan(), responses());

    expect(result.requestIds).toEqual(["request-one"]);
    expect(result.assignments).toEqual([
      {
        slug: "usb-c-compatibility",
        blogKey: "compatibility",
        mode: "explicit",
        score: null,
        matchedTopics: ["USB-C and USB PD"]
      }
    ]);
    expect(result.manifest.items[0]).toMatchObject({
      blogKey: "compatibility",
      article: { slug: "usb-c-compatibility" },
      provenance: {
        generationRequestId: "request-one",
        sourceUrls: ["https://example.org/source-b", "https://example.com/source-a"]
      }
    });
  });

  it("fails before producing a batch when import integrity validation fails", () => {
    const changed = responses();
    changed.items[0].article.slug = "changed-slug";

    expect(() => new GeneratedArticleBatchCompilerService().execute(plan(), changed)).toThrow(
      "changed the requested slug"
    );
  });
});
