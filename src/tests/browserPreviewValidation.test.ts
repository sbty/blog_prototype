import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateBrowserPreviewEvidence,
  validateBrowserPreviewUrl,
  validateDryRunNetworkGuardResult
} from "../services/browserPreviewValidation.js";

const networkGuard = {
  blockedMutationRequests: 1,
  blockedRequests: [{ method: "POST", url: "https://www.blogger.com/api/save" }],
  blockedRequestLogTruncated: false
};

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const dryRun = {
  screenshotPath: "",
  currentUrl: "https://www.blogger.com/blog/post/edit/123/456",
  publishButtonVisible: true,
  postSettings: {
    labels: [],
    searchDescription: "description",
    slug: "preview",
    applied: true as const
  },
  networkGuard
};

describe("validateDryRunNetworkGuardResult", () => {
  it("accepts consistent sanitized telemetry", () => {
    expect(() => validateDryRunNetworkGuardResult(networkGuard)).not.toThrow();
  });

  it("rejects inconsistent request counts", () => {
    expect(() =>
      validateDryRunNetworkGuardResult({
        ...networkGuard,
        blockedMutationRequests: 0
      })
    ).toThrow("inconsistent request details");
  });

  it("rejects URLs containing query secrets", () => {
    expect(() =>
      validateDryRunNetworkGuardResult({
        ...networkGuard,
        blockedRequests: [{ method: "POST", url: "https://www.blogger.com/save?token=secret" }]
      })
    ).toThrow("unsanitized");
  });
  it.each(["GET", "post"])("rejects a non-mutation method record: %s", (method) => {
    expect(() =>
      validateDryRunNetworkGuardResult({
        ...networkGuard,
        blockedRequests: [{ method, url: "https://www.blogger.com/api/save" }]
      })
    ).toThrow("non-mutation");
  });

  it("rejects request URLs containing credentials", () => {
    expect(() =>
      validateDryRunNetworkGuardResult({
        ...networkGuard,
        blockedRequests: [{ method: "POST", url: "https://user:password@www.blogger.com/api/save" }]
      })
    ).toThrow("unsanitized");
  });
});

describe("validateBrowserPreviewEvidence", () => {
  it("accepts a non-empty screenshot inside the artifact directory", async () => {
    const artifactDir = mkdtempSync(path.join(os.tmpdir(), "browser-preview-"));
    const screenshotPath = path.join(artifactDir, "screenshots", "preview.png");
    mkdirSync(path.dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, pngSignature);
    await expect(
      validateBrowserPreviewEvidence({ ...dryRun, screenshotPath }, artifactDir)
    ).resolves.toEqual(pngSignature);
  });

  it("rejects a missing screenshot", async () => {
    const artifactDir = mkdtempSync(path.join(os.tmpdir(), "browser-preview-"));
    await expect(
      validateBrowserPreviewEvidence(
        { ...dryRun, screenshotPath: path.join(artifactDir, "missing.png") },
        artifactDir
      )
    ).rejects.toThrow("does not exist");
  });

  it("rejects a screenshot outside the artifact directory", async () => {
    const artifactDir = mkdtempSync(path.join(os.tmpdir(), "browser-preview-"));
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), "browser-preview-outside-"));
    const screenshotPath = path.join(outsideDir, "preview.png");
    writeFileSync(screenshotPath, pngSignature);
    await expect(
      validateBrowserPreviewEvidence({ ...dryRun, screenshotPath }, artifactDir)
    ).rejects.toThrow("outside the job artifact directory");
  });
  it("rejects a non-PNG screenshot", async () => {
    const artifactDir = mkdtempSync(path.join(os.tmpdir(), "browser-preview-"));
    const screenshotPath = path.join(artifactDir, "screenshots", "preview.png");
    mkdirSync(path.dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, "not a png");
    await expect(
      validateBrowserPreviewEvidence({ ...dryRun, screenshotPath }, artifactDir)
    ).rejects.toThrow("not a valid PNG");
  });

  it("rejects a screenshot outside the screenshots directory", async () => {
    const artifactDir = mkdtempSync(path.join(os.tmpdir(), "browser-preview-"));
    const screenshotPath = path.join(artifactDir, "preview.png");
    writeFileSync(screenshotPath, pngSignature);
    await expect(
      validateBrowserPreviewEvidence({ ...dryRun, screenshotPath }, artifactDir)
    ).rejects.toThrow("inside the screenshots directory");
  });
});

describe("validateBrowserPreviewUrl", () => {
  it.each([
    "https://example.com/blog/post/edit/123/456",
    "https://www.blogger.com/blog/posts/123",
    "not-a-url"
  ])("rejects a non-editor URL: %s", (currentUrl) => {
    expect(() => validateBrowserPreviewUrl(currentUrl)).toThrow();
  });

  it.each([
    "https://www.blogger.com/blog/post/edit/123?token=secret",
    "https://www.blogger.com/blog/post/edit/123#private",
    "https://user:password@www.blogger.com/blog/post/edit/123"
  ])("rejects an unsanitized editor URL: %s", (currentUrl) => {
    expect(() => validateBrowserPreviewUrl(currentUrl)).toThrow("unsanitized");
  });
});
