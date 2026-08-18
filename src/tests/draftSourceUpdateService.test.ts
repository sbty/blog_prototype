import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BloggerSelectors } from "../browser/bloggerSelectors.js";
import { loadConfig } from "../config/env.js";
import { DraftSourceUpdateService } from "../services/draftSourceUpdateService.js";

const blogId = "1111111111111111111";
const sourceUrl = "https://example.com/official";

function manifest() {
  return {
    operation: "save-drafts",
    blogs: [
      {
        blogKey: "lab",
        displayName: "Lab",
        adminUrl: `https://www.blogger.com/blog/posts/${blogId}`,
        primaryTheme: "Technical guidance",
        targetLength: { min: 1, max: 5000 },
        blogger: {
          selectorsPath: "./config/blogger-selectors.json",
          postEditorUrl: `https://www.blogger.com/blog/post/edit/${blogId}/2222222222222222222`
        }
      }
    ],
    items: [
      {
        blogKey: "lab",
        article: {
          title: "Official guide",
          html: `<article><p>Body</p><section class="official-sources"><h2>Official</h2><a href="${sourceUrl}">Source</a></section></article>`,
          labels: ["guide"],
          searchDescription: "Guide",
          slug: "official-guide"
        },
        provenance: {
          generationRequestId: "request-one",
          sourceUrls: [sourceUrl]
        }
      }
    ]
  };
}

function config(authorized = blogId) {
  return loadConfig({
    DATA_DIR: mkdtempSync(path.join(os.tmpdir(), "draft-source-update-")),
    ENABLE_DRAFT_SAVE: "true",
    ENABLE_SCHEDULED_POST: "false",
    AUTHORIZED_BLOG_IDS: authorized
  });
}

describe("DraftSourceUpdateService", () => {
  it("builds authorized exact-title targets and writes a result artifact", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        blogKey: "lab",
        slug: "official-guide",
        status: "SAVED",
        sourceCount: 1,
        titlePreserved: true,
        imagePreserved: true,
        beforeLength: 100,
        afterLength: 200,
        screenshotPath: "shot.png"
      }
    ]);
    const service = new DraftSourceUpdateService(config(), {} as BloggerSelectors, { execute });

    const result = await service.execute(manifest());

    expect(result.counts).toEqual({ total: 1, saved: 1, alreadyPresent: 0 });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        blogKey: "lab",
        slug: "official-guide",
        title: "Official guide",
        sourceUrls: [sourceUrl],
        sourceSectionHtml: expect.stringContaining("official-sources")
      })
    ]);
  });

  it("rejects a Blogger target outside the explicit authorization allowlist", async () => {
    const service = new DraftSourceUpdateService(
      config("3333333333333333333"),
      {} as BloggerSelectors,
      { execute: vi.fn() }
    );
    await expect(service.execute(manifest())).rejects.toThrow(
      "Draft source update target is not authorized: lab"
    );
  });

  it("rejects missing provenance before opening Blogger", async () => {
    const input = manifest();
    delete (input.items[0] as { provenance?: unknown }).provenance;
    const service = new DraftSourceUpdateService(config(), {} as BloggerSelectors, {
      execute: vi.fn()
    });
    await expect(service.execute(input)).rejects.toThrow(
      "Draft source update requires provenance: lab/official-guide"
    );
  });
});
