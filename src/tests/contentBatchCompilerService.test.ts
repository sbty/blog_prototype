import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ContentBatchCompilerService } from "../services/contentBatchCompilerService.js";

function blog(blogKey: string, blogId: string, topic: string) {
  return {
    blogKey,
    displayName: blogKey,
    adminUrl: `https://www.blogger.com/blog/posts/${blogId}`,
    primaryTheme: topic,
    topicClusters: [topic]
  };
}

function plan() {
  return {
    targetOperation: "save-drafts",
    blogs: [
      blog("compatibility", "1111111111111111111", "USB-C compatibility"),
      blog("troubleshooting", "2222222222222222222", "PC game troubleshooting")
    ],
    requests: [
      {
        requestId: "request-usb-c",
        blogKey: "compatibility",
        slug: "usb-c-power-check",
        topic: "USB-C power compatibility",
        searchIntent: "Check charging compatibility",
        routingTopics: ["USB-C compatibility"],
        requiredPoints: ["Explain power negotiation"],
        sourceUrls: ["https://example.com/usb-c"]
      },
      {
        requestId: "request-game-stutter",
        blogKey: "troubleshooting",
        slug: "pc-game-stutter-check",
        topic: "PC game stutter troubleshooting",
        searchIntent: "Diagnose game stutter",
        routingTopics: ["PC game troubleshooting"],
        requiredPoints: ["Explain frame-time checks"],
        sourceUrls: ["https://example.org/game-stutter"]
      }
    ]
  };
}

function article(title: string, slug: string) {
  return {
    title,
    html: `<h2>${title}</h2><p>Use the official specification and verify each setting.</p>`,
    labels: ["guide"],
    searchDescription: `${title} verification guide.`,
    slug
  };
}

function responses() {
  return {
    schemaVersion: 1,
    items: [
      {
        requestId: "request-game-stutter",
        article: article("PC game stutter checks", "pc-game-stutter-check"),
        sourceUrlsUsed: ["https://example.org/game-stutter"]
      },
      {
        requestId: "request-usb-c",
        article: article("USB-C power checks", "usb-c-power-check"),
        sourceUrlsUsed: ["https://example.com/usb-c"]
      }
    ]
  };
}

function png(dir: string, name: string): string {
  const file = path.join(dir, `${name}.png`);
  writeFileSync(file, Buffer.from("89504e470d0a1a0a00000000", "hex"));
  return file;
}

describe("ContentBatchCompilerService", () => {
  it("compiles multiple generated articles and images into one multi-blog batch", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "content-batch-"));
    const usbImage = png(dir, "usb-c");
    const gameImage = png(dir, "game");
    const result = await new ContentBatchCompilerService().execute(plan(), responses(), {
      schemaVersion: 1,
      items: [
        {
          blogKey: "troubleshooting",
          slug: "pc-game-stutter-check",
          imagePath: gameImage
        },
        { blogKey: "compatibility", slug: "usb-c-power-check", imagePath: usbImage }
      ]
    });

    expect(result.manifest.operation).toBe("save-drafts");
    expect(result.manifest.items.map((item) => item.blogKey)).toEqual([
      "compatibility",
      "troubleshooting"
    ]);
    expect(result.manifest.items.map((item) => item.article.imagePath)).toEqual([
      path.resolve(usbImage),
      path.resolve(gameImage)
    ]);
    expect(result.manifest.items.map((item) => item.provenance?.generationRequestId)).toEqual([
      "request-usb-c",
      "request-game-stutter"
    ]);
    expect(result.requestIds).toEqual(["request-usb-c", "request-game-stutter"]);
    expect(result.images).toHaveLength(2);
  });

  it("rejects invalid generated content before accepting image assignments", async () => {
    const invalid = responses();
    invalid.items[1].article.slug = "changed-slug";

    await expect(
      new ContentBatchCompilerService().execute(plan(), invalid, { schemaVersion: 1, items: [] })
    ).rejects.toThrow("changed the requested slug");
  });

  it("rejects incomplete image coverage after generated content passes validation", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "content-batch-"));
    const usbImage = png(dir, "usb-c");

    await expect(
      new ContentBatchCompilerService().execute(plan(), responses(), {
        schemaVersion: 1,
        items: [{ blogKey: "compatibility", slug: "usb-c-power-check", imagePath: usbImage }]
      })
    ).rejects.toThrow("missing batch items: troubleshooting/pc-game-stutter-check");
  });
});
