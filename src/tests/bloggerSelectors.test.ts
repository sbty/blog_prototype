import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadBloggerSelectors } from "../browser/bloggerSelectors.js";

describe("loadBloggerSelectors", () => {
  it("loads a partial file and applies non-empty defaults", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "selectors-"));
    const file = path.join(root, "selectors.json");
    writeFileSync(file, JSON.stringify({ titleInput: "#title" }));
    const selectors = await loadBloggerSelectors(file, root);
    expect(selectors.titleInput).toBe("#title");
    expect(selectors.bodyEditable.length).toBeGreaterThan(0);
  });

  it("uses defaults only for a missing file inside the config root", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "selectors-"));
    const selectors = await loadBloggerSelectors(path.join(root, "missing.json"), root);
    expect(selectors.publishButton.length).toBeGreaterThan(0);
  });

  it("rejects paths outside the config root", async () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), "selectors-parent-"));
    const root = path.join(parent, "config");
    mkdirSync(root);
    await expect(loadBloggerSelectors(path.join(parent, "outside.json"), root)).rejects.toThrow(
      "inside the config directory"
    );
  });

  it.each([{ titleInput: "" }, { unknownSelector: "#unknown" }])(
    "rejects invalid selector configuration: %j",
    async (value) => {
      const root = mkdtempSync(path.join(os.tmpdir(), "selectors-"));
      const file = path.join(root, "selectors.json");
      writeFileSync(file, JSON.stringify(value));
      await expect(loadBloggerSelectors(file, root)).rejects.toThrow();
    }
  );
});