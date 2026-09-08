export interface BloggerEditorIdentity {
  expectedBlogId?: string;
  actualBlogId: string;
}

export function extractBloggerBlogId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (url.hostname !== "www.blogger.com" && url.hostname !== "blogger.com") return undefined;
  if (url.username || url.password || url.search || url.hash) return undefined;
  return url.pathname.match(/^\/blog\/(?:posts|post\/edit)\/(\d+)/)?.[1];
}

export function extractBloggerPostId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (url.hostname !== "www.blogger.com" && url.hostname !== "blogger.com") return undefined;
  if (url.username || url.password || url.search || url.hash) return undefined;
  return url.pathname.match(/^\/blog\/post\/edit\/\d+\/(\d+)\/?$/)?.[1];
}

/** Normalizes Blogger's relative post-list links without inheriting `/blog/posts/` from the list URL. */
export function normalizeBloggerEditUrl(
  href: string | null | undefined,
  currentPageUrl: string
): string | undefined {
  if (!href) return undefined;
  const match = href.match(/(?:^|\/)blog\/post\/edit\/(\d+)\/(\d+)\/?(?:[?#].*)?$/);
  if (!match) return undefined;
  let current: URL;
  try {
    current = new URL(currentPageUrl);
  } catch {
    return undefined;
  }
  if (
    current.protocol !== "https:" ||
    !["www.blogger.com", "blogger.com"].includes(current.hostname)
  ) {
    return undefined;
  }
  return `https://${current.hostname}/blog/post/edit/${match[1]}/${match[2]}`;
}

export function validateBloggerEditorIdentity(input: {
  adminUrl: string;
  postEditorUrl?: string;
  currentUrl: string;
}): BloggerEditorIdentity {
  const expectedBlogId =
    extractBloggerBlogId(input.postEditorUrl) ?? extractBloggerBlogId(input.adminUrl);
  let currentUrl: URL;
  try {
    currentUrl = new URL(input.currentUrl);
  } catch {
    throw new Error(`Blogger editor returned an invalid URL: ${input.currentUrl}`);
  }
  if (
    currentUrl.protocol !== "https:" ||
    !["www.blogger.com", "blogger.com"].includes(currentUrl.hostname)
  ) {
    throw new Error(`Blogger editor did not finish on Blogger: ${input.currentUrl}`);
  }
  if (currentUrl.username || currentUrl.password || currentUrl.search || currentUrl.hash) {
    throw new Error("Blogger editor returned an unsanitized URL");
  }
  const actualBlogId = currentUrl.pathname.match(/^\/blog\/post\/edit\/(\d+)(?:\/\d+)?\/?$/)?.[1];
  if (!actualBlogId) {
    throw new Error(`Blogger editor URL does not identify an editable blog: ${input.currentUrl}`);
  }
  if (expectedBlogId && actualBlogId !== expectedBlogId) {
    throw new Error(
      `Blogger editor opened blog ${actualBlogId}, expected configured blog ${expectedBlogId}`
    );
  }
  return { expectedBlogId, actualBlogId };
}
