import { describe, expect, it } from "vitest";
import { BatchSourceAttachmentService } from "../services/batchSourceAttachmentService.js";

function batch() {
  return {
    operation: "save-drafts",
    blogs: [
      {
        blogKey: "lab",
        displayName: "Lab",
        adminUrl: "https://www.blogger.com/blog/posts/1111111111111111111",
        primaryTheme: "Compatibility",
        targetLength: { min: 1, max: 5000 }
      }
    ],
    items: [
      {
        blogKey: "lab",
        article: {
          title: "USB-C compatibility",
          html: "<article><h2>Conclusion</h2><p>Check all devices.</p></article>",
          labels: ["USB-C"],
          searchDescription: "Compatibility guide",
          slug: "usb-c-compatibility"
        }
      }
    ]
  };
}

function assignments() {
  return {
    schemaVersion: 1,
    items: [
      {
        blogKey: "lab",
        slug: "usb-c-compatibility",
        generationRequestId: "legacy-draft-usb-c",
        sources: [
          {
            title: "USB PD <official>",
            url: "https://www.usb.org/usb-charger-pd"
          }
        ]
      }
    ]
  };
}

describe("BatchSourceAttachmentService", () => {
  it("adds provenance and a cited official-source section without changing other article fields", () => {
    const input = batch();
    const result = new BatchSourceAttachmentService().execute(input, assignments());
    const item = result.manifest.items[0];

    expect(item.article).toMatchObject({
      title: input.items[0].article.title,
      labels: input.items[0].article.labels,
      searchDescription: input.items[0].article.searchDescription,
      slug: input.items[0].article.slug
    });
    expect(item.article.html).toContain('<section class="official-sources"><h2>公式情報</h2>');
    expect(item.article.html).toContain("USB PD &lt;official&gt;");
    expect(item.article.html.indexOf("official-sources")).toBeLessThan(
      item.article.html.indexOf("</article>")
    );
    expect(item.provenance).toEqual({
      generationRequestId: "legacy-draft-usb-c",
      sourceUrls: ["https://www.usb.org/usb-charger-pd"]
    });
    expect(result.sources).toEqual([
      {
        blogKey: "lab",
        slug: "usb-c-compatibility",
        generationRequestId: "legacy-draft-usb-c",
        sourceCount: 1
      }
    ]);
  });

  it("requires exact coverage of batch items", () => {
    const input = batch();
    input.items.push({
      ...input.items[0],
      article: { ...input.items[0].article, slug: "second-article" }
    });

    expect(() => new BatchSourceAttachmentService().execute(input, assignments())).toThrow(
      "Source assignments are missing batch items: lab/second-article"
    );
  });

  it("refuses to overwrite existing provenance", () => {
    const input = batch();
    Object.assign(input.items[0], {
      provenance: {
        generationRequestId: "existing",
        sourceUrls: ["https://example.com/source"]
      }
    });

    expect(() => new BatchSourceAttachmentService().execute(input, assignments())).toThrow(
      "Batch items already contain provenance"
    );
  });

  it("rejects unsafe and duplicate source assignments", () => {
    const duplicate = assignments();
    duplicate.items[0].sources.push({
      title: "Duplicate",
      url: "https://www.usb.org/usb-charger-pd"
    });
    expect(() => new BatchSourceAttachmentService().execute(batch(), duplicate)).toThrow();

    const unsafe = assignments();
    unsafe.items[0].sources[0].url = "http://example.com/source";
    expect(() => new BatchSourceAttachmentService().execute(batch(), unsafe)).toThrow();
  });
});
