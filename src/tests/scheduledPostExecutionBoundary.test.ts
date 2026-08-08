import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("scheduled post execution boundary", () => {
  const source = readFileSync(
    path.resolve("src/services/scheduledPostExecutionService.ts"),
    "utf8"
  );

  it("restricts execution to an explicit blog allowlist", () => {
    expect(source).toContain("getAuthorizedBloggerBlogIds(this.config)");
    expect(source).toContain("requires AUTHORIZED_BLOG_IDS");
    expect(source).toContain("restricted to an authorized blog");
  });

  it("requires the explicit execution flag and disables draft save", () => {
    expect(source).toContain("!this.config.ENABLE_SCHEDULED_POST || this.config.ENABLE_DRAFT_SAVE");
  });

  it("creates an exclusive attempt marker before Blogger mutation", () => {
    const marker = source.indexOf('"schedule-execution-attempt.json"');
    const mutation = source.indexOf(").schedulePost(");
    expect(marker).toBeGreaterThan(-1);
    expect(mutation).toBeGreaterThan(marker);
    expect(source).toContain("writeJsonArtifactExclusive");
  });

  it("requires package and independent audit hashes", () => {
    expect(source).toContain("calculateArtifactSha256(packageBytes)");
    expect(source).toContain("calculateArtifactSha256(auditBytes)");
    expect(source).toContain("audit.packageSha256 !== input.packageSha256");
  });

  it("uploads the configured image before opening the publish confirmation", () => {
    const browserSource = readFileSync(path.resolve("src/browser/bloggerDryRun.ts"), "utf8");
    const scheduleMethod = browserSource.indexOf("async schedulePost");
    const imageUpload = browserSource.indexOf("new BloggerImageUploader", scheduleMethod);
    const publishClick = browserSource.indexOf("publish.click()", scheduleMethod);
    expect(imageUpload).toBeGreaterThan(scheduleMethod);
    expect(publishClick).toBeGreaterThan(imageUpload);
  });
});
