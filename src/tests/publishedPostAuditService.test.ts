import { describe, expect, it, vi } from "vitest";
import type { BlogConfig } from "../config/blogConfig.js";
import type { ArticleInput } from "../domain/article.js";
import { PublishedPostAuditService } from "../services/publishedPostAuditService.js";

const blog = { publicUrl: "https://example.blogspot.com/" } as BlogConfig;
const article = { title: "公開後監査テスト" } as ArticleInput;

function entry(overrides: Record<string, unknown> = {}) {
  return {
    title: { $t: article.title },
    published: { $t: "2026-08-05T22:00:00.000+09:00" },
    updated: { $t: "2026-08-05T22:00:00.000+09:00" },
    content: { $t: '<p>本文</p><img src="https://blogger.googleusercontent.com/post.png">' },
    link: [{ rel: "alternate", href: "https://example.blogspot.com/2026/08/post.html" }],
    ...overrides
  };
}

function feedResponse(entries: unknown[]): Response {
  return new Response(JSON.stringify({ feed: { entry: entries } }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("PublishedPostAuditService", () => {
  it("verifies exactly one published post and one nonempty image", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(feedResponse([entry()]))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-length": "3", "content-type": "image/png" }
        })
      ) as unknown as typeof fetch;

    const result = await new PublishedPostAuditService(
      fetchImpl,
      () => new Date("2026-08-06T00:00:00.000Z")
    ).execute({ blog, article });

    expect(result).toMatchObject({
      title: article.title,
      matchCount: 1,
      contentPresent: true,
      imageCount: 1,
      imageStatus: 200,
      imageBytes: 3,
      auditedAt: "2026-08-06T00:00:00.000Z"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["missing", []],
    ["duplicate", [entry(), entry()]]
  ])("rejects %s title matches", async (_case, entries) => {
    const fetchImpl = vi.fn().mockResolvedValue(feedResponse(entries)) as unknown as typeof fetch;
    await expect(
      new PublishedPostAuditService(fetchImpl).execute({ blog, article })
    ).rejects.toThrow(`expected exactly one title match, found ${entries.length}`);
  });

  it.each([
    ["missing", "<p>本文</p>", 0],
    [
      "duplicate",
      '<img src="https://blogger.googleusercontent.com/one.png"><img src="https://blogger.googleusercontent.com/two.png">',
      2
    ]
  ])("rejects a %s image", async (_case, content, count) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        feedResponse([entry({ content: { $t: content } })])
      ) as unknown as typeof fetch;
    await expect(
      new PublishedPostAuditService(fetchImpl).execute({ blog, article })
    ).rejects.toThrow(`expected exactly one image, found ${count}`);
  });

  it("rejects feed and image HTTP failures", async () => {
    const feedFailure = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 503 })) as unknown as typeof fetch;
    await expect(
      new PublishedPostAuditService(feedFailure).execute({ blog, article })
    ).rejects.toThrow("feed request failed: HTTP 503");

    const imageFailure = vi
      .fn()
      .mockResolvedValueOnce(feedResponse([entry()]))
      .mockResolvedValueOnce(new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(
      new PublishedPostAuditService(imageFailure).execute({ blog, article })
    ).rejects.toThrow("image request failed: HTTP 404");
  });

  it("rejects an image on an untrusted host", async () => {
    const untrusted = entry({
      content: { $t: '<img src="https://untrusted.example/image.png">' }
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(feedResponse([untrusted])) as unknown as typeof fetch;
    await expect(
      new PublishedPostAuditService(fetchImpl).execute({ blog, article })
    ).rejects.toThrow("image URL must use a Blogger-managed host");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a successful non-image response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(feedResponse([entry()]))
      .mockResolvedValueOnce(
        new Response("not an image", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
      ) as unknown as typeof fetch;
    await expect(
      new PublishedPostAuditService(fetchImpl).execute({ blog, article })
    ).rejects.toThrow("image response is not an image");
  });
});
