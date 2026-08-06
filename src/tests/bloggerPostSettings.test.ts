import { describe, expect, it, vi } from "vitest";
import {
  normalizePostSettings,
  performPostSettingsMutationWithGuard,
  validatePostSettingField
} from "../browser/bloggerPostSettings.js";

const article = {
  title: "Title",
  html: "<p>Body</p>",
  labels: [" policy ", "policy", "analysis"],
  searchDescription: " Description ",
  slug: "Resolution-Basics"
};

describe("normalizePostSettings", () => {
  it("normalizes labels, description, and slug", () => {
    expect(normalizePostSettings(article)).toEqual({
      labels: ["policy", "analysis"],
      searchDescription: "Description",
      slug: "resolution-basics"
    });
  });

  it("rejects invalid slugs and long descriptions", () => {
    expect(() => normalizePostSettings({ ...article, slug: "invalid slug" })).toThrow(
      "lowercase ASCII"
    );
    expect(() => normalizePostSettings({ ...article, searchDescription: "x".repeat(151) })).toThrow(
      "150 characters"
    );
  });
});
describe("performPostSettingsMutationWithGuard", () => {
  it("does not mutate post settings after STOP", async () => {
    const mutation = vi.fn(async () => undefined);
    await expect(
      performPostSettingsMutationWithGuard(async () => {
        throw new Error("STOP requested");
      }, mutation)
    ).rejects.toThrow("STOP requested");
    expect(mutation).not.toHaveBeenCalled();
  });
});
describe("validatePostSettingField", () => {
  it("accepts a matching value read back from the UI", () => {
    expect(() =>
      validatePostSettingField("slug", " article-slug ", "article-slug")
    ).not.toThrow();
  });

  it("rejects a value that the UI did not retain", () => {
    expect(() =>
      validatePostSettingField("slug", "other-slug", "article-slug")
    ).toThrow("slug value mismatch");
  });
});