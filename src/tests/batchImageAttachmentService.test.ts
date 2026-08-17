import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BatchImageAttachmentService } from "../services/batchImageAttachmentService.js";

function article(slug: string, imagePath?: string) {
  return {
    title: `Article ${slug}`,
    html: `<p>${slug}</p>`,
    labels: [],
    searchDescription: `Description ${slug}`,
    slug,
    ...(imagePath ? { imagePath } : {})
  };
}

function batch(
  items = [
    { blogKey: "blog-one", article: article("first") },
    {
      blogKey: "blog-two",
      article: article("second"),
      provenance: {
        generationRequestId: "request-second",
        sourceUrls: ["https://example.com/source"]
      }
    }
  ]
) {
  return {
    operation: "save-drafts",
    blogs: [
      {
        blogKey: "blog-one",
        displayName: "Blog One",
        adminUrl: "https://www.blogger.com/blog/posts/1111111111111111111",
        primaryTheme: "Theme one"
      },
      {
        blogKey: "blog-two",
        displayName: "Blog Two",
        adminUrl: "https://www.blogger.com/blog/posts/2222222222222222222",
        primaryTheme: "Theme two"
      }
    ],
    items
  };
}

function png(dir: string, name: string): string {
  const file = path.join(dir, `${name}.png`);
  writeFileSync(file, Buffer.from("89504e470d0a1a0a00000000", "hex"));
  return file;
}

describe("BatchImageAttachmentService", () => {
  it("attaches one validated unique image to every batch item and preserves provenance", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "batch-images-"));
    const first = png(dir, "first");
    const second = png(dir, "second");
    const result = await new BatchImageAttachmentService().execute(batch(), {
      schemaVersion: 1,
      items: [
        { blogKey: "blog-two", slug: "second", imagePath: second },
        { blogKey: "blog-one", slug: "first", imagePath: first }
      ]
    });

    expect(result.manifest.items.map((item) => item.article.imagePath)).toEqual([
      path.resolve(first),
      path.resolve(second)
    ]);
    expect(result.manifest.items[1].provenance).toEqual({
      generationRequestId: "request-second",
      sourceUrls: ["https://example.com/source"]
    });
    expect(result.images).toEqual([
      { blogKey: "blog-one", slug: "first", imagePath: path.resolve(first), sizeBytes: 12 },
      { blogKey: "blog-two", slug: "second", imagePath: path.resolve(second), sizeBytes: 12 }
    ]);
  });

  it("rejects missing, unknown, and duplicate assignments", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "batch-images-"));
    const first = png(dir, "first");
    await expect(
      new BatchImageAttachmentService().execute(batch(), {
        schemaVersion: 1,
        items: [{ blogKey: "blog-one", slug: "first", imagePath: first }]
      })
    ).rejects.toThrow("missing batch items: blog-two/second");
    await expect(
      new BatchImageAttachmentService().execute(batch(), {
        schemaVersion: 1,
        items: [
          { blogKey: "blog-one", slug: "first", imagePath: first },
          { blogKey: "missing", slug: "second", imagePath: first }
        ]
      })
    ).rejects.toThrow("unknown batch items: missing/second");
    await expect(
      new BatchImageAttachmentService().execute(batch(), {
        schemaVersion: 1,
        items: [
          { blogKey: "blog-one", slug: "first", imagePath: first },
          { blogKey: "blog-one", slug: "first", imagePath: first }
        ]
      })
    ).rejects.toThrow("Duplicate image assignment: blog-one/first");
  });

  it("rejects existing article images and reuse of one physical file", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "batch-images-"));
    const image = png(dir, "shared");
    await expect(
      new BatchImageAttachmentService().execute(
        batch([
          { blogKey: "blog-one", article: article("first", image) },
          { blogKey: "blog-two", article: article("second") }
        ]),
        {
          schemaVersion: 1,
          items: [
            { blogKey: "blog-one", slug: "first", imagePath: image },
            { blogKey: "blog-two", slug: "second", imagePath: image }
          ]
        }
      )
    ).rejects.toThrow("already contain imagePath: blog-one/first");
    await expect(
      new BatchImageAttachmentService().execute(batch(), {
        schemaVersion: 1,
        items: [
          { blogKey: "blog-one", slug: "first", imagePath: image },
          { blogKey: "blog-two", slug: "second", imagePath: image }
        ]
      })
    ).rejects.toThrow("assigned to multiple batch items");
  });

  it("validates every image before returning a manifest", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "batch-images-"));
    const first = png(dir, "first");
    await expect(
      new BatchImageAttachmentService().execute(batch(), {
        schemaVersion: 1,
        items: [
          { blogKey: "blog-one", slug: "first", imagePath: first },
          { blogKey: "blog-two", slug: "second", imagePath: path.join(dir, "missing.png") }
        ]
      })
    ).rejects.toThrow("Image file does not exist");
  });
});
