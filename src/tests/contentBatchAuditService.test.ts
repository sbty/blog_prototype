import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ContentBatchAuditService } from "../services/contentBatchAuditService.js";
import {
  problematicFirstOperationalBatch16,
  problematicGenericBoilerplate
} from "./fixtures/problematicFirstOperationalBatch16.js";

function png(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "content-audit-"));
  const file = path.join(dir, "image.png");
  writeFileSync(file, Buffer.from("89504e470d0a1a0a00000000", "hex"));
  return file;
}

function batch(overrides: Record<string, unknown> = {}) {
  const sourceUrl = "https://example.com/official-source";
  return {
    operation: "save-drafts",
    blogs: [
      {
        blogKey: "compatibility",
        displayName: "Compatibility",
        adminUrl: "https://www.blogger.com/blog/posts/1111111111111111111",
        primaryTheme: "Compatibility",
        targetLength: { min: 20, max: 500 },
        excludedTopics: ["unsafe bypass"]
      }
    ],
    items: [
      {
        blogKey: "compatibility",
        article: {
          title: "Compatibility checks",
          html: `<h2>Check the specification</h2><p>Confirm every supported profile before purchase using the <a href="${sourceUrl}">official source</a>.</p>`,
          labels: ["compatibility"],
          searchDescription: "A concise compatibility checking guide.",
          slug: "compatibility-checks",
          imagePath: png()
        },
        provenance: {
          generationRequestId: "request-one",
          sourceUrls: [sourceUrl],
          contentBrief: {
            topic: "USB-C device compatibility",
            searchIntent: "Check whether two USB-C devices work together",
            requiredPoints: ["Compare the supported specification"]
          }
        }
      }
    ],
    ...overrides
  };
}

describe("ContentBatchAuditService", () => {
  it("passes a provenance-bearing image article that meets editorial checks", async () => {
    const result = await new ContentBatchAuditService().execute(batch());

    expect(result).toMatchObject({
      schemaVersion: 1,
      status: "PASS",
      counts: { total: 1, passed: 1, failed: 0, errors: 0, warnings: 0 },
      items: [
        {
          blogKey: "compatibility",
          slug: "compatibility-checks",
          status: "PASS",
          metrics: { sourceCount: 1, citedSourceCount: 1, labelCount: 1, imageBytes: 12 },
          issues: []
        }
      ]
    });
    expect(Date.parse(result.generatedAt)).not.toBeNaN();
  });

  it("fails on missing provenance citations, invalid length, excluded topics, and image", async () => {
    const input = batch();
    input.items[0].article.html = "<p>unsafe bypass</p>";
    input.items[0].article.searchDescription = "x".repeat(151);
    delete (input.items[0].article as { imagePath?: string }).imagePath;

    const result = await new ContentBatchAuditService().execute(input);
    const codes = result.items[0].issues.map((issue) => issue.code);

    expect(result.status).toBe("FAIL");
    expect(codes).toEqual(
      expect.arrayContaining([
        "TARGET_LENGTH",
        "SOURCE_CITATION_MISSING",
        "SEARCH_DESCRIPTION_LENGTH",
        "H2_MISSING",
        "EXCLUDED_TOPIC",
        "IMAGE_MISSING"
      ])
    );
  });

  it("reports structural recommendations as warnings without failing the batch", async () => {
    const input = batch();
    input.items[0].article.title = "x".repeat(101);
    input.items[0].article.html = input.items[0].article.html
      .replace("<h2>", "<p>")
      .replace("</h2>", "</p>");
    input.items[0].article.labels = [];

    const result = await new ContentBatchAuditService().execute(input);

    expect(result.status).toBe("PASS");
    expect(result.counts).toMatchObject({ errors: 0, warnings: 3 });
    expect(result.items[0].issues.map((issue) => issue.code)).toEqual([
      "H2_MISSING",
      "LABELS_MISSING",
      "TITLE_LONG"
    ]);
  });

  it("fails when the referenced local image cannot be validated", async () => {
    const input = batch();
    input.items[0].article.imagePath = path.join(os.tmpdir(), "missing-content-audit-image.png");

    const result = await new ContentBatchAuditService().execute(input);

    expect(result.status).toBe("FAIL");
    expect(result.items[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "IMAGE_INVALID", severity: "ERROR" })
      ])
    );
  });

  it("treats an out-of-range numeric HTML entity as whitespace instead of crashing", async () => {
    const input = batch();
    input.items[0].article.html = input.items[0].article.html.replace(
      "Confirm every",
      "Confirm &#999999999; every"
    );

    await expect(new ContentBatchAuditService().execute(input)).resolves.toMatchObject({
      status: "PASS"
    });
  });

  it("fails all 16 saved-draft regressions that contain the generic remediation boilerplate", async () => {
    const input = batch({
      items: problematicFirstOperationalBatch16.map((slug) => ({
        blogKey: "compatibility",
        article: {
          title: `${slug} focused guide`,
          html: `<h2>Focused guide</h2><p><a href="https://example.com/official-source">Official source</a></p>${problematicGenericBoilerplate}`,
          labels: ["compatibility"],
          searchDescription: "A focused guide with an official source.",
          slug,
          imagePath: png()
        },
        provenance: {
          generationRequestId: `request-${slug}`,
          sourceUrls: ["https://example.com/official-source"],
          contentBrief: {
            topic: `${slug} focused guide`,
            searchIntent: "Resolve the exact topic in the title",
            requiredPoints: ["Use the official source"]
          }
        }
      }))
    });

    const result = await new ContentBatchAuditService().execute(input);

    expect(result).toMatchObject({
      status: "FAIL",
      counts: { total: 16, passed: 0, failed: 16 }
    });
    expect(
      result.items.every((item) =>
        item.issues.some(
          (issue) => issue.code === "GENERIC_BOILERPLATE" && issue.severity === "ERROR"
        )
      )
    ).toBe(true);
  });

  it("fails a paragraph headed by terminology unrelated to the article brief", async () => {
    const input = batch();
    input.items[0].article.html = `<h2>Flight and passport preparation</h2><p>Before travel, confirm your itinerary, flight, and passport.</p><p><a href="https://example.com/official-source">Official source</a></p>`;

    const result = await new ContentBatchAuditService().execute(input);

    expect(result.status).toBe("FAIL");
    expect(result.items[0].issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "TOPIC_DRIFT", severity: "ERROR" })])
    );
  });

  it("does not treat a software article's ownership and sign-in context as account drift", async () => {
    const input = batch();
    input.items[0].article.title = "Steam DRM basics";
    input.items[0].provenance.contentBrief = {
      topic: "Steam DRM basics",
      searchIntent: "Explain DRM ownership checks",
      requiredPoints: ["Explain the Steam client launch flow"]
    };
    input.items[0].article.html = `<h2>Steam DRM ownership checks</h2><p>Launch through Steam, sign in, and confirm the game is owned by the linked account. <a href="https://example.com/official-source">Official source</a></p>`;

    await expect(new ContentBatchAuditService().execute(input)).resolves.toMatchObject({
      status: "PASS"
    });
  });

  it("does not treat travel terminology as drift when the brief is explicitly about travel", async () => {
    const input = batch();
    input.items[0].article.title = "Schengen travel dates";
    input.items[0].provenance.contentBrief = {
      topic: "Schengen travel date calculation",
      searchIntent: "Check a travel itinerary against the short-stay rule",
      requiredPoints: ["Explain the 90/180-day travel rule"]
    };
    input.items[0].article.html = `<h2>Travel itinerary calculation</h2><p>For travel, confirm the itinerary, flight, passport, and entry conditions. <a href="https://example.com/official-source">Official source</a></p>`;

    await expect(new ContentBatchAuditService().execute(input)).resolves.toMatchObject({
      status: "PASS"
    });
  });
});
