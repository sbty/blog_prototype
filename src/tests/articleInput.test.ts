import { describe, expect, it } from "vitest";
import { articleInputSchema } from "../domain/article.js";

const valid = {
  title: "Article title",
  html: "<p>body</p>",
  searchDescription: "description",
  slug: "article-title"
};

describe("articleInputSchema", () => {
  it("applies an empty labels default", () => {
    expect(articleInputSchema.parse(valid).labels).toEqual([]);
  });

  it.each([
    { ...valid, title: " " },
    { ...valid, html: " \n " },
    { ...valid, slug: "Unsafe Slug" },
    { ...valid, labels: [1] },
    { ...valid, scheduledAt: "not-a-date" },
    { ...valid, unknown: true }
  ])("rejects invalid article input: %j", (article) => {
    expect(() => articleInputSchema.parse(article)).toThrow();
  });

  it("normalizes surrounding text whitespace", () => {
    const article = articleInputSchema.parse({
      ...valid,
      title: "  Article title  ",
      labels: ["  label  "],
      searchDescription: "  description  "
    });
    expect(article).toMatchObject({
      title: "Article title",
      labels: ["label"],
      searchDescription: "description"
    });
  });

  it.each([
    '<script>alert("x")</script>',
    '<img src="x" onerror="alert(1)">',
    '<a href="javascript:alert(1)">link</a>',
    '<form action="https://example.com"><input></form>',
    '<object data="payload"></object>'
  ])("rejects active HTML: %s", (html) => {
    expect(() => articleInputSchema.parse({ ...valid, html })).toThrow(
      "Article HTML contains active content"
    );
  });

  it("rejects excessively large HTML", () => {
    expect(() => articleInputSchema.parse({ ...valid, html: "x".repeat(2_000_001) })).toThrow();
  });
});