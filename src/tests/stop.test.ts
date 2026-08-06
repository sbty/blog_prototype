import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertNotStopped, StopRequestedError } from "../system/stop.js";

describe("STOP mechanism", () => {
  it("passes when STOP file is absent", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "blogger-stop-"));
    await expect(assertNotStopped(dir)).resolves.toBeUndefined();
  });

  it("throws when STOP file exists", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "blogger-stop-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "STOP"), "");
    await expect(assertNotStopped(dir)).rejects.toBeInstanceOf(StopRequestedError);
  });

  it("passes only when the access check reports ENOENT", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    await expect(
      assertNotStopped("data", () => Promise.reject(missing))
    ).resolves.toBeUndefined();
  });

  it("fails closed when the STOP file cannot be checked", async () => {
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    await expect(
      assertNotStopped("data", () => Promise.reject(denied))
    ).rejects.toThrow("Unable to verify STOP file");
  });
});
