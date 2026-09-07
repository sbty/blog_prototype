import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ArticleInput } from "../domain/article.js";
import {
  evaluatePersistedDraft,
  type PersistedDraftInspection
} from "../domain/draftPersistence.js";

const fixturePath = new URL("./fixtures/desk-gear-lab-02-empty-permalink.json", import.meta.url);
const deskGearLab02 = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  article: ArticleInput;
  inspection: PersistedDraftInspection;
};

const expected = {
  expectedBlogId: "1111111111111111111",
  expectedPostId: "2222222222222222222",
  expectedEditUrl: "https://www.blogger.com/blog/post/edit/1111111111111111111/2222222222222222222",
  article: deskGearLab02.article
};

describe("evaluatePersistedDraft", () => {
  it("fails the desk-gear-lab-02 regression fixture when the saved permalink is empty", () => {
    const result = evaluatePersistedDraft({ ...expected, actual: deskGearLab02.inspection });
    expect(result.status).toBe("FAIL");
    expect(result.checks.permalink).toMatchObject({
      status: "FAIL",
      expected: "desk-gear-lab-02",
      actual: ""
    });
  });

  it("passes only an exact persisted draft with one expected image", () => {
    const result = evaluatePersistedDraft({
      ...expected,
      actual: { ...deskGearLab02.inspection, slug: deskGearLab02.article.slug }
    });
    expect(result.status).toBe("PASS");
  });

  it.each([
    ["another slug", { slug: "other-slug" }],
    ["post ID mismatch", { postId: "9999999999" }],
    ["scheduled state", { postState: "SCHEDULED" as const }],
    ["published state", { postState: "PUBLISHED" as const }],
    ["missing image", { slug: deskGearLab02.article.slug, imageCount: 0 }],
    ["duplicate image", { slug: deskGearLab02.article.slug, imageCount: 2 }],
    ["body difference", { slug: deskGearLab02.article.slug, html: "<p>別の本文</p>" }],
    ["settings difference", { slug: deskGearLab02.article.slug, labels: [] }]
  ])("fails %s", (_name, override) => {
    const result = evaluatePersistedDraft({
      ...expected,
      actual: { ...deskGearLab02.inspection, ...override }
    });
    expect(result.status).toBe("FAIL");
  });

  it("fails when a fresh-session read returns blog-post instead of the requested slug", () => {
    const result = evaluatePersistedDraft({
      ...expected,
      actual: { ...deskGearLab02.inspection, slug: "blog-post" }
    });

    expect(result.status).toBe("FAIL");
    expect(result.checks.permalink).toMatchObject({ status: "FAIL", actual: "blog-post" });
  });

  it("fails a permalink-only save when any non-permalink field changes", () => {
    const result = evaluatePersistedDraft({
      ...expected,
      actual: {
        ...deskGearLab02.inspection,
        slug: deskGearLab02.article.slug,
        searchDescription: "保存処理で変化した説明"
      }
    });

    expect(result.status).toBe("FAIL");
    expect(result.checks.permalink.status).toBe("PASS");
    expect(result.checks.searchDescription.status).toBe("FAIL");
  });
});
