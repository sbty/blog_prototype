import type { BlogConfig } from "../config/blogConfig.js";
import { getAuthorizedBloggerBlogIds, type AppConfig } from "../config/env.js";

function extractBloggerBlogId(blog: BlogConfig): string | undefined {
  for (const candidate of [blog.blogger.postEditorUrl, blog.adminUrl]) {
    if (!candidate) continue;
    try {
      const match = new URL(candidate).pathname.match(/^\/blog\/(?:posts|post\/edit)\/(\d+)/);
      if (match) return match[1];
    } catch {
      // Blog configuration validation reports malformed URLs before this boundary.
    }
  }
  return undefined;
}

export function assertDraftSaveAuthorized(config: AppConfig, blogs: readonly BlogConfig[]): void {
  const authorizedBlogIds = getAuthorizedBloggerBlogIds(config);
  if (authorizedBlogIds.size === 0) {
    throw new Error("Draft save requires AUTHORIZED_BLOG_IDS or AUTHORIZED_TEST_BLOG_ID");
  }
  for (const blog of blogs) {
    const blogId = extractBloggerBlogId(blog);
    if (!blogId || !authorizedBlogIds.has(blogId)) {
      throw new Error(`Draft save is not authorized for blog ${blogId ?? "unknown"}`);
    }
  }
}
