import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { DraftSaveResult } from "../browser/bloggerDryRun.js";

const BLOGGER_EDIT_PATH = /^\/blog\/post\/edit\/(\d+)\/(\d+)\/?$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface DraftSaveExpectation {
  adminUrl: string;
  postEditorUrl?: string;
}

function extractConfiguredBlogId(expectation: DraftSaveExpectation): string | undefined {
  for (const candidate of [expectation.postEditorUrl, expectation.adminUrl]) {
    if (!candidate) continue;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    const match = url.pathname.match(/^\/blog\/(?:posts|post\/edit)\/(\d+)/);
    if (match) return match[1];
  }
  return undefined;
}

export function validateDraftSaveResult(
  result: DraftSaveResult,
  expectation?: DraftSaveExpectation
): DraftSaveResult {
  let url: URL;
  try {
    url = new URL(result.currentUrl);
  } catch {
    throw new Error(`Draft save returned an invalid URL: ${result.currentUrl}`);
  }

  if (url.protocol !== "https:" || url.hostname !== "www.blogger.com") {
    throw new Error(`Draft save did not finish on Blogger: ${result.currentUrl}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Draft save returned an unsanitized Blogger URL");
  }
  const editMatch = url.pathname.match(BLOGGER_EDIT_PATH);
  if (!editMatch) {
    throw new Error(`Draft save did not return a persisted Blogger edit URL: ${result.currentUrl}`);
  }
  const expectedBlogId = expectation ? extractConfiguredBlogId(expectation) : undefined;
  if (expectedBlogId && editMatch[1] !== expectedBlogId) {
    throw new Error(
      `Draft save returned an edit URL for blog ${editMatch[1]}, expected blog ${expectedBlogId}`
    );
  }
  const savedAtMillis = Date.parse(result.savedAt);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result.savedAt) ||
    !Number.isFinite(savedAtMillis) ||
    new Date(savedAtMillis).toISOString() !== result.savedAt
  ) {
    throw new Error(`Draft save returned an invalid savedAt timestamp: ${result.savedAt}`);
  }
  return result;
}
export async function validateDraftSaveEvidence(
  result: DraftSaveResult,
  artifactDir: string
): Promise<void> {
  const resolvedArtifactDir = await realpath(artifactDir);
  let resolvedScreenshot: string;
  try {
    resolvedScreenshot = await realpath(result.screenshotPath);
  } catch {
    throw new Error(`Draft save screenshot does not exist: ${result.screenshotPath}`);
  }

  const relativePath = path.relative(resolvedArtifactDir, resolvedScreenshot);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Draft save screenshot is outside the job artifact directory: ${result.screenshotPath}`);
  }  const pathParts = relativePath.split(path.sep);
  if (
    pathParts.length < 2 ||
    pathParts[0].toLowerCase() !== "screenshots" ||
    path.extname(resolvedScreenshot).toLowerCase() !== ".png"
  ) {
    throw new Error(
      `Draft save screenshot must be a PNG inside the screenshots directory: ${result.screenshotPath}`
    );
  }
  const screenshotStat = await stat(resolvedScreenshot);
  if (!screenshotStat.isFile() || screenshotStat.size === 0) {
    throw new Error(`Draft save screenshot is empty or not a file: ${result.screenshotPath}`);
  }  const screenshot = await open(resolvedScreenshot, "r");
  try {
    const signature = Buffer.alloc(PNG_SIGNATURE.length);
    const { bytesRead } = await screenshot.read(signature, 0, signature.length, 0);
    if (bytesRead !== PNG_SIGNATURE.length || !signature.equals(PNG_SIGNATURE)) {
      throw new Error(`Draft save screenshot is not a valid PNG: ${result.screenshotPath}`);
    }
  } finally {
    await screenshot.close();
  }
}