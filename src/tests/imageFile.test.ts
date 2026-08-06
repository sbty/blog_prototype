import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateImageFile } from "../browser/imageFile.js";

describe("validateImageFile", () => {
  it("resolves a supported non-empty image", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "blogger-image-"));
    const file = path.join(dir, "hero.PNG");
    writeFileSync(file, Buffer.from("89504e470d0a1a0a", "hex"));

    await expect(validateImageFile(file)).resolves.toMatchObject({
      absolutePath: path.resolve(file),
      extension: ".png",
      sizeBytes: 8
    });
  });

  it("rejects missing, empty, and unsupported files", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "blogger-image-"));
    const empty = path.join(dir, "empty.jpg");
    const unsupported = path.join(dir, "image.svg");
    writeFileSync(empty, Buffer.alloc(0));
    writeFileSync(unsupported, "<svg/>");

    await expect(validateImageFile(path.join(dir, "missing.png"))).rejects.toThrow(
      "does not exist"
    );
    await expect(validateImageFile(empty)).rejects.toThrow("is empty");
    await expect(validateImageFile(unsupported)).rejects.toThrow("Unsupported image extension");
  });

  it("rejects renamed non-images and mismatched formats", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "blogger-image-"));
    const fakePng = path.join(dir, "secret.png");
    const mismatched = path.join(dir, "photo.jpg");
    writeFileSync(fakePng, "not an image");
    writeFileSync(mismatched, Buffer.from("89504e470d0a1a0a", "hex"));
    await expect(validateImageFile(fakePng)).rejects.toThrow("do not match extension");
    await expect(validateImageFile(mismatched)).rejects.toThrow("do not match extension");
  });
});