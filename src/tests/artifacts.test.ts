import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createArtifactDir,
  makeJobId,
  readArtifactFileInsideDirectory,
  writeJsonArtifactAtomic,
  writeJsonArtifactExclusive,
  writeTextArtifactAtomic
} from "../services/artifacts.js";

describe("atomic artifact writes", () => {
  it("generates safe collision-resistant job IDs", () => {
    const first = makeJobId("draft");
    const second = makeJobId("draft");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/);
  });
  it("replaces an artifact completely without leaving temporary files", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "atomic-artifact-"));
    const artifactPath = path.join(dir, "artifact.json");

    await writeTextArtifactAtomic(artifactPath, "old trailing content");
    await writeJsonArtifactAtomic(artifactPath, { state: "ready" });

    expect(JSON.parse(readFileSync(artifactPath, "utf8"))).toEqual({ state: "ready" });
    expect(readdirSync(dir)).toEqual(["artifact.json"]);
  });

  it("creates an exclusive JSON artifact without overwriting it", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "exclusive-artifact-"));
    const artifactPath = path.join(dir, "artifact.json");
    await writeJsonArtifactExclusive(artifactPath, { state: "sealed" });
    await expect(writeJsonArtifactExclusive(artifactPath, { state: "changed" })).rejects.toThrow();
    expect(JSON.parse(readFileSync(artifactPath, "utf8"))).toEqual({ state: "sealed" });
    expect(readdirSync(dir)).toEqual(["artifact.json"]);
  });
  it("reads only regular artifact files addressed by a basename", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bounded-artifact-read-"));
    writeFileSync(path.join(dir, "artifact.json"), "bounded");
    mkdirSync(path.join(dir, "directory"));

    await expect(readArtifactFileInsideDirectory(dir, "artifact.json")).resolves.toEqual(
      Buffer.from("bounded")
    );
    await expect(readArtifactFileInsideDirectory(dir, "../outside.json")).rejects.toThrow(
      "must not contain a path"
    );
    await expect(readArtifactFileInsideDirectory(dir, "directory")).rejects.toThrow(
      "not a regular file"
    );
  });
  it("rejects an artifact link that physically resolves outside the job directory", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bounded-artifact-link-"));
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), "outside-artifact-link-"));
    writeFileSync(path.join(outsideDir, "secret.json"), "outside");
    symlinkSync(outsideDir, path.join(dir, "linked-artifact"), "junction");

    await expect(readArtifactFileInsideDirectory(dir, "linked-artifact")).rejects.toThrow(
      "physically resolve inside"
    );
  });
  it("rejects unsafe job IDs before creating an artifact directory", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "artifact-path-"));
    await expect(createArtifactDir(dir, "../escape")).rejects.toThrow("not safe");
    await expect(createArtifactDir(dir, "C:\\escape")).rejects.toThrow("not safe");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("rejects non-JSON values without leaving files", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "atomic-artifact-json-"));
    const artifactPath = path.join(dir, "artifact.json");
    await expect(writeJsonArtifactAtomic(artifactPath, 1n)).rejects.toThrow(
      "JSON-serializable"
    );
    expect(readdirSync(dir)).toEqual([]);
  });
});