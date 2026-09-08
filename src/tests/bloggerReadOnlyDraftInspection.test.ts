import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Blogger read-only draft inspection", () => {
  const source = readFileSync(path.resolve("src/browser/bloggerDryRun.ts"), "utf8");
  const start = source.indexOf("async inspectExistingDraft");
  const method = source.slice(start, source.indexOf("async saveDraft", start));

  it("opens a fresh context and reads the complete draft without UI mutation", () => {
    expect(start).toBeGreaterThan(-1);
    expect(method).toContain("const context = await this.openContext()");
    expect(method).toContain("await page.goto(input.postEditorUrl");
    expect(method).toContain("await this.readDraftHtml(page)");
    expect(method).toContain("await this.countDraftImages(page)");
    expect(method).not.toContain(".click(");
    expect(method).not.toContain(".fill(");
    expect(method).not.toContain(".press(");
  });

  it("collects identity, metadata, state, and image evidence for the complete audit", () => {
    for (const field of [
      "blogId: identity.actualBlogId",
      "postId: extractBloggerPostId",
      "postState: this.detectPostState",
      "publishedAt,",
      "scheduledDate:",
      "scheduledTime:",
      "labels:",
      "searchDescription:",
      "slug:",
      "imageCount:"
    ]) {
      expect(method).toContain(field);
    }
  });

  it("reads post-list rows without editing Blogger", () => {
    const start = source.indexOf("async listPosts");
    const method = source.slice(start, source.indexOf("async inspectExistingDraft", start));
    expect(method).toContain("const context = await this.openContext()");
    expect(method).toContain("await page.goto(input.adminUrl");
    expect(method).toContain("detectPostListState");
    expect(method).not.toContain(".click(");
    expect(method).not.toContain(".fill(");
    expect(method).not.toContain(".press(");
  });

  it("rejects an unavailable session before treating an empty title search as evidence", () => {
    const start = source.indexOf("async findDrafts");
    const method = source.slice(start, source.indexOf("async listPosts", start));
    expect(method).toContain("await this.assertReadOnlySessionReady(page)");
    expect(method).not.toContain(".click(");
    expect(method).not.toContain(".fill(");
    expect(method).not.toContain(".press(");
  });
});
