import { open, realpath } from "node:fs/promises";
import path from "node:path";
import type { DryRunResult } from "../browser/bloggerDryRun.js";
import {
  isPotentialMutationRequest,
  type DryRunNetworkGuardResult
} from "../browser/dryRunNetworkGuard.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function validateBrowserPreviewUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Browser preview returned an invalid URL: ${value}`);
  }
  if (
    url.protocol !== "https:" ||
    !["www.blogger.com", "blogger.com"].includes(url.hostname) ||
    !/^\/blog\/post\/edit\/\d+(?:\/\d+)?\/?$/.test(url.pathname)
  ) {
    throw new Error(`Browser preview did not finish in a Blogger editor: ${value}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Browser preview returned an unsanitized Blogger URL");
  }
}
export function validateDryRunNetworkGuardResult(result: DryRunNetworkGuardResult): void {
  if (!Number.isInteger(result.blockedMutationRequests) || result.blockedMutationRequests < 0) {
    throw new Error("Dry-run network guard returned an invalid blocked request count");
  }
  if (result.blockedRequests.length > result.blockedMutationRequests) {
    throw new Error("Dry-run network guard returned inconsistent request details");
  }
  const shouldBeTruncated = result.blockedMutationRequests > result.blockedRequests.length;
  if (result.blockedRequestLogTruncated !== shouldBeTruncated) {
    throw new Error("Dry-run network guard returned an inconsistent truncation flag");
  }
  for (const request of result.blockedRequests) {
    if (!request.method || !request.url) {
      throw new Error("Dry-run network guard returned an incomplete request record");
    }
    if (
      request.method !== request.method.toUpperCase() ||
      !isPotentialMutationRequest(request.method)
    ) {
      throw new Error("Dry-run network guard returned a non-mutation request record");
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      throw new Error("Dry-run network guard returned an invalid request URL");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("Dry-run network guard returned an unsanitized request URL");
    }
  }
}

export async function validateBrowserPreviewEvidence(
  result: DryRunResult,
  artifactDir: string
): Promise<Buffer> {
  validateBrowserPreviewUrl(result.currentUrl);
  validateDryRunNetworkGuardResult(result.networkGuard);
  const resolvedArtifactDir = await realpath(artifactDir);
  let resolvedScreenshot: string;
  try {
    resolvedScreenshot = await realpath(result.screenshotPath);
  } catch {
    throw new Error(`Browser preview screenshot does not exist: ${result.screenshotPath}`);
  }
  const relativePath = path.relative(resolvedArtifactDir, resolvedScreenshot);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `Browser preview screenshot is outside the job artifact directory: ${result.screenshotPath}`
    );
  }
  const pathParts = relativePath.split(path.sep);
  if (
    pathParts.length < 2 ||
    pathParts[0].toLowerCase() !== "screenshots" ||
    path.extname(resolvedScreenshot).toLowerCase() !== ".png"
  ) {
    throw new Error(
      `Browser preview screenshot must be a PNG inside the screenshots directory: ${result.screenshotPath}`
    );
  }
  const screenshot = await open(resolvedScreenshot, "r");
  try {
    const screenshotStat = await screenshot.stat();
    if (!screenshotStat.isFile() || screenshotStat.size === 0) {
      throw new Error(
        `Browser preview screenshot is empty or not a file: ${result.screenshotPath}`
      );
    }
    const screenshotBytes = await screenshot.readFile();
    if (
      screenshotBytes.length < PNG_SIGNATURE.length ||
      !screenshotBytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    ) {
      throw new Error(`Browser preview screenshot is not a valid PNG: ${result.screenshotPath}`);
    }
    return screenshotBytes;
  } finally {
    await screenshot.close();
  }
}
