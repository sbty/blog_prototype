import type { BlogConfig } from "../config/blogConfig.js";
import type { ArticleInput } from "../domain/article.js";

const MAX_FEED_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 20_000_000;

function isAllowedPublishedImageHost(hostname: string, blogHostname: string): boolean {
  return (
    hostname === blogHostname ||
    hostname === "googleusercontent.com" ||
    hostname.endsWith(".googleusercontent.com") ||
    hostname === "blogspot.com" ||
    hostname.endsWith(".blogspot.com")
  );
}

export interface PublishedPostAuditResult {
  title: string;
  matchCount: 1;
  publicUrl: string;
  publishedAt: string;
  updatedAt: string;
  contentPresent: true;
  imageCount: 1;
  imageUrl: string;
  imageStatus: 200;
  imageBytes: number;
  auditedAt: string;
}

interface FeedEntry {
  title?: { $t?: unknown };
  published?: { $t?: unknown };
  updated?: { $t?: unknown };
  content?: { $t?: unknown };
  link?: Array<{ rel?: unknown; href?: unknown }>;
}

export class PublishedPostAuditService {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: {
    blog: BlogConfig;
    article: ArticleInput;
  }): Promise<PublishedPostAuditResult> {
    if (!input.blog.publicUrl) throw new Error("Published post audit requires blog.publicUrl");
    const blogUrl = new URL(input.blog.publicUrl);
    if (blogUrl.protocol !== "https:") throw new Error("Published post audit requires HTTPS");
    const feedUrl = new URL("feeds/posts/default?alt=json&max-results=50", blogUrl);
    const feedResponse = await this.fetchImpl(feedUrl, {
      method: "GET",
      signal: AbortSignal.timeout(10_000)
    });
    if (!feedResponse.ok) {
      throw new Error(`Published post feed request failed: HTTP ${feedResponse.status}`);
    }
    const feedText = await feedResponse.text();
    if (Buffer.byteLength(feedText, "utf8") > MAX_FEED_BYTES) {
      throw new Error("Published post feed is too large");
    }
    let feed: { feed?: { entry?: FeedEntry[] } };
    try {
      feed = JSON.parse(feedText) as typeof feed;
    } catch {
      throw new Error("Published post feed is not valid JSON");
    }
    const matches = (feed.feed?.entry ?? []).filter(
      (entry) => entry.title?.$t === input.article.title
    );
    if (matches.length !== 1) {
      throw new Error(
        `Published post audit expected exactly one title match, found ${matches.length}`
      );
    }
    const entry = matches[0];
    const publishedAt = entry.published?.$t;
    const updatedAt = entry.updated?.$t;
    const content = entry.content?.$t;
    if (
      typeof publishedAt !== "string" ||
      !Number.isFinite(Date.parse(publishedAt)) ||
      typeof updatedAt !== "string" ||
      !Number.isFinite(Date.parse(updatedAt))
    ) {
      throw new Error("Published post audit found invalid timestamps");
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("Published post audit found empty content");
    }
    const alternate = entry.link?.find((link) => link.rel === "alternate")?.href;
    if (typeof alternate !== "string") throw new Error("Published post audit found no public URL");
    const publicUrl = new URL(alternate);
    if (publicUrl.protocol !== "https:" || publicUrl.origin !== blogUrl.origin) {
      throw new Error("Published post audit found an unexpected public URL");
    }
    const images = [...content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)];
    if (images.length !== 1) {
      throw new Error(`Published post audit expected exactly one image, found ${images.length}`);
    }
    const imageUrl = new URL(images[0][1]);
    if (imageUrl.protocol !== "https:") throw new Error("Published image URL must use HTTPS");
    if (!isAllowedPublishedImageHost(imageUrl.hostname, blogUrl.hostname)) {
      throw new Error("Published image URL must use a Blogger-managed host");
    }
    const imageResponse = await this.fetchImpl(imageUrl, {
      method: "GET",
      signal: AbortSignal.timeout(10_000)
    });
    if (imageResponse.status !== 200) {
      throw new Error(`Published image request failed: HTTP ${imageResponse.status}`);
    }
    const contentType = imageResponse.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) {
      throw new Error("Published image response is not an image");
    }
    const declaredImageBytes = Number(imageResponse.headers.get("content-length") ?? "0");
    if (declaredImageBytes > MAX_IMAGE_BYTES) throw new Error("Published image is too large");
    const body = await imageResponse.arrayBuffer();
    const verifiedImageBytes = body.byteLength;
    if (verifiedImageBytes <= 0) throw new Error("Published image is empty");
    if (verifiedImageBytes > MAX_IMAGE_BYTES) throw new Error("Published image is too large");
    return {
      title: input.article.title,
      matchCount: 1,
      publicUrl: publicUrl.toString(),
      publishedAt,
      updatedAt,
      contentPresent: true,
      imageCount: 1,
      imageUrl: imageUrl.toString(),
      imageStatus: 200,
      imageBytes: verifiedImageBytes,
      auditedAt: this.now().toISOString()
    };
  }
}
