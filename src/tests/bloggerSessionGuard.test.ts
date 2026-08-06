import { describe, expect, it } from "vitest";
import { detectBloggerSessionIssue } from "../browser/bloggerSessionGuard.js";

const ready = {
  url: "https://www.blogger.com/blog/post/edit/123/456",
  bodyText: "Post title Publish Preview",
  hasPasswordInput: false,
  hasCaptchaFrame: false
};

describe("detectBloggerSessionIssue", () => {
  it("accepts a normal Blogger editor", () => {
    expect(detectBloggerSessionIssue(ready)).toBeNull();
  });

  it.each([
    "https://example.com/fake-blogger",
    "http://www.blogger.com/blog/post/edit/123/456",
    "not-a-url"
  ])("rejects an unexpected browser origin: %s", (url) => {
    expect(detectBloggerSessionIssue({ ...ready, url })).toBe("UNEXPECTED_ORIGIN");
  });
  it("detects a Google login redirect", () => {
    expect(
      detectBloggerSessionIssue({ ...ready, url: "https://accounts.google.com/signin/v2" })
    ).toBe("LOGIN_REQUIRED");
  });

  it("detects a visible password prompt", () => {
    expect(detectBloggerSessionIssue({ ...ready, hasPasswordInput: true })).toBe(
      "LOGIN_REQUIRED"
    );
  });

  it("detects reCAPTCHA before login handling", () => {
    expect(
      detectBloggerSessionIssue({ ...ready, hasPasswordInput: true, hasCaptchaFrame: true })
    ).toBe("CAPTCHA_REQUIRED");
  });

  it("detects Japanese access denial text", () => {
    expect(detectBloggerSessionIssue({ ...ready, bodyText: "\u3053\u306e\u30da\u30fc\u30b8\u3078\u306e\u30a2\u30af\u30bb\u30b9\u304c\u62d2\u5426\u3055\u308c\u307e\u3057\u305f" })).toBe(
      "ACCESS_DENIED"
    );
  });
});