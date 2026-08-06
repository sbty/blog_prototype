export interface BloggerSessionSignals {
  url: string;
  bodyText: string;
  hasPasswordInput: boolean;
  hasCaptchaFrame: boolean;
}

export type BloggerSessionIssue =
  | "LOGIN_REQUIRED"
  | "CAPTCHA_REQUIRED"
  | "ACCESS_DENIED"
  | "UNEXPECTED_ORIGIN";

export function detectBloggerSessionIssue(
  signals: BloggerSessionSignals
): BloggerSessionIssue | null {
  const normalizedText = signals.bodyText.toLowerCase();
  let currentUrl: URL;
  try {
    currentUrl = new URL(signals.url);
  } catch {
    return "UNEXPECTED_ORIGIN";
  }
  if (currentUrl.protocol !== "https:") return "UNEXPECTED_ORIGIN";
  if (currentUrl.hostname === "accounts.google.com") return "LOGIN_REQUIRED";
  if (currentUrl.hostname !== "www.blogger.com" && currentUrl.hostname !== "blogger.com") {
    return "UNEXPECTED_ORIGIN";
  }
  if (
    signals.hasCaptchaFrame ||
    normalizedText.includes("i'm not a robot") ||
    normalizedText.includes("\u79c1\u306f\u30ed\u30dc\u30c3\u30c8\u3067\u306f\u3042\u308a\u307e\u305b\u3093") ||
    normalizedText.includes("recaptcha")
  ) {
    return "CAPTCHA_REQUIRED";
  }
  if (
    signals.hasPasswordInput ||
    normalizedText.includes("sign in with your google account") ||
    normalizedText.includes("google \u30a2\u30ab\u30a6\u30f3\u30c8\u3067\u30ed\u30b0\u30a4\u30f3")
  ) {
    return "LOGIN_REQUIRED";
  }
  if (
    normalizedText.includes("access denied") ||
    normalizedText.includes("you don't have permission") ||
    normalizedText.includes("\u6a29\u9650\u304c\u3042\u308a\u307e\u305b\u3093") ||
    normalizedText.includes("\u30a2\u30af\u30bb\u30b9\u304c\u62d2\u5426\u3055\u308c\u307e\u3057\u305f")
  ) {
    return "ACCESS_DENIED";
  }
  return null;
}