import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Blogger post-state detection", () => {
  const browserClient = readFileSync(path.resolve("src/browser/bloggerDryRun.ts"), "utf8");
  const selectorSource = readFileSync(path.resolve("src/browser/bloggerSelectors.ts"), "utf8");

  it("treats a visible Publish action as a draft even if Blogger retains old date input values", () => {
    const start = browserClient.indexOf("private detectPostState");
    const method = browserClient.slice(
      start,
      browserClient.indexOf("private detectPostListState", start)
    );

    expect(method).toContain("/(^|\\s)(公開|Publish)(\\s|$)/i.test(input.publishText.trim())");
    expect(method.indexOf("/(^|\\s)(公開|Publish)(\\s|$)/i")).toBeLessThan(
      method.indexOf("hasScheduledDate")
    );
    expect(browserClient).toContain('publish.getAttribute("aria-label")');
    expect(selectorSource).toContain('[jsname="vdQQuc"], [aria-label="\\u516c\\u958b"]');
  });

  it("accepts the duplicated labels Blogger exposes for a Japanese Publish action", () => {
    expect(/(^|\s)(公開|Publish)(\s|$)/i.test("公開 公開")).toBe(true);
  });
});
