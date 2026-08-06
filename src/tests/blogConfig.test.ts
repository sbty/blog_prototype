import { describe, expect, it } from "vitest";
import { blogConfigSchema } from "../config/blogConfig.js";

const minimal = {
  blogKey: "blog-1",
  displayName: "Test Blog",
  adminUrl: "https://www.blogger.com/blog/posts/123",
  primaryTheme: "international affairs"
};

describe("blogConfigSchema", () => {
  it("applies a coherent default policy", () => {
    const config = blogConfigSchema.parse(minimal);
    expect(config.targetLength).toEqual({ min: 3000, max: 5000 });
    expect(Object.values(config.contentPolicy).reduce((sum, value) => sum + value, 0)).toBe(1);
  });

  it("rejects an inverted target length range", () => {
    expect(() =>
      blogConfigSchema.parse({ ...minimal, targetLength: { min: 5000, max: 3000 } })
    ).toThrow("targetLength.min");
  });

  it("rejects content policy ratios that do not total one", () => {
    expect(() =>
      blogConfigSchema.parse({
        ...minimal,
        contentPolicy: {
          evergreenRatio: 0.5,
          durableExplainerRatio: 0.2,
          seasonalRatio: 0.1,
          newsRatio: 0.1
        }
      })
    ).toThrow("ratios must total 1");
  });

  it.each([
    "http://www.blogger.com/blog/posts/123",
    "https://example.com/blog/posts/123",
    "https://user:secret@www.blogger.com/blog/posts/123"
  ])("rejects an unsafe Blogger admin URL: %s", (adminUrl) => {
    expect(() => blogConfigSchema.parse({ ...minimal, adminUrl })).toThrow();
  });

  it("rejects an external post editor URL", () => {
    expect(() =>
      blogConfigSchema.parse({
        ...minimal,
        blogger: { postEditorUrl: "https://example.com/editor" }
      })
    ).toThrow("official blogger.com host");
  });
});