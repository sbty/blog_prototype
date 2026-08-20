import { describe, expect, it } from "vitest";
import { ContentRemediationImportService } from "../services/contentRemediationImportService.js";
import { ContentRemediationPackageService } from "../services/contentRemediationPackageService.js";

const sourceUrl = "https://example.com/official-source";
const researchedUrl = "https://example.org/researched-source";

function batch() {
  return {
    operation: "save-drafts",
    continueOnError: false,
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
        primaryTheme: "Second topic",
        targetLength: { min: 1000, max: 3000 }
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
        metrics: {
          textLength: 100,
          targetLengthMin: 10,
          targetLengthMax: 5000,
          sourceCount: 0,
          citedSourceCount: 0,
          labelCount: 1,
          imageBytes: 100
        },
        issues: []
      },
      {
        index: 1,
        blogKey: "two",
        slug: "needs-correction",
        status: "FAIL",
        metrics: {
          textLength: 20,
          targetLengthMin: 1000,
          targetLengthMax: 3000,
          sourceCount: 1,
          citedSourceCount: 1,
          labelCount: 1,
          imageBytes: 100
        },
        issues: [{ code: "TARGET_LENGTH", severity: "ERROR", message: "Article is too short" }]
      }
    ]
  };
}

function remediationPackage(source = batch()) {
  return new ContentRemediationPackageService().execute(source, audit());
}

function responses(urls = [sourceUrl]) {
  return {
    schemaVersion: 1,
    items: [
      {
        remediationId: "content-remediation-0002",
        article: {
          title: "Corrected article",
          html: `<h2>Corrected</h2><p>Detailed guidance from <a href="${urls[0]}">the official source</a>.</p>`,
          labels: ["guide", "corrected"],
          searchDescription: "Corrected description",
          slug: "needs-correction"
        },
        sourceUrlsUsed: urls
      }
    ]
  };
}

describe("ContentRemediationImportService", () => {
  it("imports corrected failed content while preserving operational fields", () => {
    const source = batch();
    const result = new ContentRemediationImportService().execute(
      source,
      remediationPackage(source),
      responses()
    );

    expect(result.manifest.operation).toBe("save-drafts");
    expect(result.manifest.continueOnError).toBe(false);
    expect(result.manifest.blogs.map((blog) => blog.blogKey)).toEqual(["two"]);
    expect(result.manifest.items).toHaveLength(1);
    expect(result.manifest.items[0]).toMatchObject({
      blogKey: "two",
      article: {
        title: "Corrected article",
        slug: "needs-correction",
        imagePath: "C:\\private\\generated-image.png",
        scheduledAt: "2026-08-20T00:00:00.000Z"
      },
      provenance: { generationRequestId: "request-two", sourceUrls: [sourceUrl] }
    });
    expect(result.importedAssignments).toEqual([
      {
        remediationId: "content-remediation-0002",
        sourceIndex: 1,
        blogKey: "two",
        slug: "needs-correction"
      }
    ]);
  });

  it("accepts researched HTTPS sources when the original article had no provenance", () => {
    const source = batch();
    delete (source.items[1] as { provenance?: unknown }).provenance;
    const result = new ContentRemediationImportService().execute(
      source,
      remediationPackage(source),
      responses([researchedUrl])
    );
    expect(result.manifest.items[0].provenance).toEqual({
      generationRequestId: "content-remediation-0002",
      sourceUrls: [researchedUrl]
    });
  });

  it("rejects a response that changes the stable slug", () => {
    const input = responses();
    input.items[0].article.slug = "changed-slug";
    expect(() =>
      new ContentRemediationImportService().execute(batch(), remediationPackage(), input)
    ).toThrow("changed the source slug");
  });

  it("rejects a response that does not attest to the provided sources", () => {
    expect(() =>
      new ContentRemediationImportService().execute(
        batch(),
        remediationPackage(),
        responses([researchedUrl])
      )
    ).toThrow("must attest to every provided source URL");
  });

  it("rejects unknown and duplicate response IDs", () => {
    const unknown = responses();
    unknown.items[0].remediationId = "content-remediation-9999";
    expect(() =>
      new ContentRemediationImportService().execute(batch(), remediationPackage(), unknown)
    ).toThrow("unknown IDs");

    const duplicated = responses();
    duplicated.items.push(structuredClone(duplicated.items[0]));
    expect(() =>
      new ContentRemediationImportService().execute(batch(), remediationPackage(), duplicated)
    ).toThrow("Duplicate remediationId");
  });

  it("rejects active HTML and response-only operational fields", () => {
    const active = responses();
    active.items[0].article.html = "<script>alert(1)</script>";
    expect(() =>
      new ContentRemediationImportService().execute(batch(), remediationPackage(), active)
    ).toThrow("active content");

    const withImage = structuredClone(responses()) as unknown as {
      items: Array<{ article: Record<string, unknown> }>;
    };
    withImage.items[0].article.imagePath = "C:\\untrusted.png";
    expect(() =>
      new ContentRemediationImportService().execute(batch(), remediationPackage(), withImage)
    ).toThrow();
  });

  it("rejects a stale package after the source batch changes", () => {
    const source = batch();
    const packageInput = remediationPackage(source);
    source.items[1].article.title = "Changed after export";
    expect(() =>
      new ContentRemediationImportService().execute(source, packageInput, responses())
    ).toThrow("does not match the current source batch");
  });

  it("rejects a package with altered editorial or provenance context", () => {
    const alteredEditorial = remediationPackage();
    alteredEditorial.requests[0].editorialProfile.primaryTheme = "Altered topic";
    expect(() =>
      new ContentRemediationImportService().execute(batch(), alteredEditorial, responses())
    ).toThrow("does not match the current source batch");

    const alteredSources = remediationPackage();
    alteredSources.requests[0].provenance.sourceUrls = [researchedUrl];
    expect(() =>
      new ContentRemediationImportService().execute(batch(), alteredSources, responses())
    ).toThrow("does not match the current source batch");
  });
});
