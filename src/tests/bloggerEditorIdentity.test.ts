import { describe, expect, it } from "vitest";
import {
  extractBloggerBlogId,
  validateBloggerEditorIdentity
} from "../browser/bloggerEditorIdentity.js";

describe("Blogger editor identity", () => {
  it("extracts blog IDs from list and editor URLs", () => {
    expect(extractBloggerBlogId("https://www.blogger.com/blog/posts/123")).toBe("123");
    expect(extractBloggerBlogId("https://www.blogger.com/blog/post/edit/456/789")).toBe("456");
  });

  it("accepts the configured blog editor", () => {
    expect(
      validateBloggerEditorIdentity({
        adminUrl: "https://www.blogger.com/blog/posts/123",
        currentUrl: "https://www.blogger.com/blog/post/edit/123/456"
      })
    ).toEqual({ expectedBlogId: "123", actualBlogId: "123" });
  });

  it("accepts a new-post editor URL without a post ID", () => {
    expect(
      validateBloggerEditorIdentity({
        adminUrl: "https://www.blogger.com/blog/posts/123",
        currentUrl: "https://www.blogger.com/blog/post/edit/123"
      }).actualBlogId
    ).toBe("123");
  });

  it("rejects an editor belonging to another blog", () => {
    expect(() =>
      validateBloggerEditorIdentity({
        adminUrl: "https://www.blogger.com/blog/posts/123",
        currentUrl: "https://www.blogger.com/blog/post/edit/999/456"
      })
    ).toThrow("expected configured blog 123");
  });

  it("rejects a Blogger page that is not an editor", () => {
    expect(() =>
      validateBloggerEditorIdentity({
        adminUrl: "https://www.blogger.com/blog/posts/123",
        currentUrl: "https://www.blogger.com/blog/posts/123"
      })
    ).toThrow("does not identify an editable blog");
  });

  it("rejects an editor-shaped URL outside Blogger", () => {
    expect(() =>
      validateBloggerEditorIdentity({
        adminUrl: "https://www.blogger.com/blog/posts/123",
        currentUrl: "https://example.com/blog/post/edit/123/456"
      })
    ).toThrow("did not finish on Blogger");
  });

  it.each([
    "https://www.blogger.com/blog/post/edit/123/456?token=secret",
    "https://www.blogger.com/blog/post/edit/123/456#private",
    "https://user:password@www.blogger.com/blog/post/edit/123/456"
  ])("rejects an unsanitized editor URL: %s", (currentUrl) => {
    expect(() =>
      validateBloggerEditorIdentity({
        adminUrl: "https://www.blogger.com/blog/posts/123",
        currentUrl
      })
    ).toThrow("unsanitized");
  });
});