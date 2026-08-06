import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateDraftSaveEvidence,
  validateDraftSaveResult
} from "../services/draftSaveValidation.js";

const validResult = {
  screenshotPath: "draft.png",
  currentUrl: "https://www.blogger.com/blog/post/edit/123/456",
  savedAt: "2026-07-30T03:00:00.000Z"
};
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("validateDraftSaveResult", () => {
  it("accepts a persisted Blogger edit URL", () => {
    expect(validateDraftSaveResult(validResult)).toBe(validResult);
  });

  it.each([
    "https://www.blogger.com/blog/posts/123",
    "https://example.com/blog/post/edit/123/456",
    "not-a-url"
  ])("rejects an unverified draft URL: %s", (currentUrl) => {
    expect(() => validateDraftSaveResult({ ...validResult, currentUrl })).toThrow();
  });

  it.each([
    "https://www.blogger.com/blog/post/edit/123/456?token=secret",
    "https://www.blogger.com/blog/post/edit/123/456#private",
    "https://user:password@www.blogger.com/blog/post/edit/123/456"
  ])("rejects an unsanitized draft URL: %s", (currentUrl) => {
    expect(() => validateDraftSaveResult({ ...validResult, currentUrl })).toThrow("unsanitized");
  });
  it("accepts the configured blog ID", () => {
    expect(
      validateDraftSaveResult(validResult, {
        adminUrl: "https://www.blogger.com/blog/posts/123"
      })
    ).toBe(validResult);
  });

  it("rejects an edit URL belonging to a different blog", () => {
    expect(() =>
      validateDraftSaveResult(validResult, {
        adminUrl: "https://www.blogger.com/blog/posts/999"
      })
    ).toThrow("expected blog 999");
  });

  it("uses postEditorUrl as the configured blog identity", () => {
    expect(() =>
      validateDraftSaveResult(validResult, {
        adminUrl: "https://www.blogger.com/",
        postEditorUrl: "https://www.blogger.com/blog/post/edit/999"
      })
    ).toThrow("expected blog 999");
  });
  it("rejects an invalid savedAt timestamp", () => {
    expect(() => validateDraftSaveResult({ ...validResult, savedAt: "invalid" })).toThrow(
      "invalid savedAt"
    );
  });
  it.each([
    "2026-07-30T03:00:00+09:00",
    "2026-02-30T03:00:00.000Z",
    "2026-07-30"
  ])("rejects a non-canonical savedAt timestamp: %s", (savedAt) => {
    expect(() => validateDraftSaveResult({ ...validResult, savedAt })).toThrow("invalid savedAt");
  });
});
describe("validateDraftSaveEvidence", () => {
  it("accepts a non-empty screenshot inside the artifact directory", async () => {
    const artifactDir = mkdtempSync(path.join(os.tmpdir(), "draft-evidence-"));
    const screenshotPath = path.join(artifactDir, "screenshots", "draft.png");
    mkdirSync(path.dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, pngSignature);

    await expect(
      validateDraftSaveEvidence({ ...validResult, screenshotPath }, artifactDir)
    ).resolves.toBeUndefined();
  });

  it("rejects a missing screenshot", async () => {
    const artifactDir = mkdtempSync(path.join(os.tmpdir(), "draft-evidence-"));
    await expect(
      validateDraftSaveEvidence(
        { ...validResult, screenshotPath: path.join(artifactDir, "missing.png") },
        artifactDir
      )
    ).rejects.toThrow("does not exist");
  });

  it("rejects a non-PNG screenshot", async () => {
    const artifactDir = mkdtempSync(path.join(os.tmpdir(), "draft-evidence-"));
    const screenshotPath = path.join(artifactDir, "screenshots", "draft.png");
    mkdirSync(path.dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, "not a png");

    await expect(
      validateDraftSaveEvidence({ ...validResult, screenshotPath }, artifactDir)
    ).rejects.toThrow("not a valid PNG");
  });
  it.each([
    ["draft.png", "png outside the screenshots directory"],
    [path.join("screenshots", "draft.jpg"), "non-png extension"]
  ])("rejects %s (%s)", async (relativePath) => {
    const artifactDir = mkdtempSync(path.join(os.tmpdir(), "draft-evidence-"));
    const screenshotPath = path.join(artifactDir, relativePath);
    mkdirSync(path.dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, pngSignature);

    await expect(
      validateDraftSaveEvidence({ ...validResult, screenshotPath }, artifactDir)
    ).rejects.toThrow("inside the screenshots directory");
  });
  it("rejects a screenshot outside the artifact directory", async () => {
    const artifactDir = mkdtempSync(path.join(os.tmpdir(), "draft-evidence-"));
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), "draft-outside-"));
    const screenshotPath = path.join(outsideDir, "draft.png");
    writeFileSync(screenshotPath, pngSignature);

    await expect(
      validateDraftSaveEvidence({ ...validResult, screenshotPath }, artifactDir)
    ).rejects.toThrow("outside the job artifact directory");
  });
});