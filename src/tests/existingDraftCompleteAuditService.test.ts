import { describe, expect, it, vi } from "vitest";
import type { BlogConfig } from "../config/blogConfig.js";
import { loadConfig } from "../config/env.js";
import type { ArticleInput } from "../domain/article.js";
import { ExistingDraftCompleteAuditService } from "../services/existingDraftCompleteAuditService.js";

const postId = "2222222222";
const editorUrl = `https://www.blogger.com/blog/post/edit/1111111111/${postId}`;
const blog = {
  blogKey: "blog-1",
  displayName: "Test Blog",
  adminUrl: "https://www.blogger.com/blog/posts/1111111111",
  primaryTheme: "test",
  language: "ja",
  targetCountry: "JP",
  targetAudience: [],
  topicClusters: [],
  excludedTopics: [],
  contentPolicy: {
    evergreenRatio: 0.55,
    durableExplainerRatio: 0.25,
    seasonalRatio: 0.1,
    newsRatio: 0.1
  },
  targetLength: { min: 3000, max: 5000 },
  dailyPostLimit: 1,
  blogger: { selectorsPath: "./config/blogger-selectors.json" }
} as BlogConfig;
const article = {
  title: "下書き監査テスト",
  html: '<p>本文</p><p><a href="https://example.com/official">公式情報</a></p>',
  labels: ["テスト", "公式情報"],
  searchDescription: "下書き監査の説明",
  slug: "draft-audit-test",
  imagePath: "C:/images/test.png"
} as ArticleInput;

function baseInspection(overrides: Record<string, unknown> = {}) {
  return {
    blogId: "1111111111",
    postId,
    editUrl: editorUrl,
    postState: "DRAFT" as const,
    title: article.title,
    html: article.html,
    labels: [...article.labels],
    searchDescription: article.searchDescription,
    slug: article.slug,
    imageCount: 1,
    ...overrides
  };
}

function service(
  input: {
    inspection?: Record<string, unknown>;
    editUrls?: string[];
  } = {}
) {
  return new ExistingDraftCompleteAuditService(
    loadConfig({ ENABLE_DRAFT_SAVE: "false", ENABLE_SCHEDULED_POST: "false" }),
    () => new Date("2026-09-01T00:00:00.000Z"),
    async () => ({
      inspectExistingDraft: async () => baseInspection(input.inspection),
      findDrafts: async () => ({
        title: article.title,
        editUrls: input.editUrls ?? [editorUrl],
        count: (input.editUrls ?? [editorUrl]).length
      })
    })
  );
}

describe("ExistingDraftCompleteAuditService", () => {
  it("passes an exact existing draft in read-only mode", async () => {
    const report = await service().execute({ blog, article, postId, postEditorUrl: editorUrl });

    expect(report.status).toBe("PASS");
    expect(report.reasons).toEqual([]);
    expect(report.auditedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(report.checks).toMatchObject({
      title: { status: "PASS" },
      body: { status: "PASS" },
      officialLinks: { status: "PASS" },
      labels: { status: "PASS" },
      imageCount: { status: "PASS" },
      duplicateTitle: { status: "PASS" }
    });
  });

  it("records a post-ID mismatch without changing the draft", async () => {
    const report = await service({ inspection: { postId: "3333333333" } }).execute({
      blog,
      article,
      postId,
      postEditorUrl: editorUrl
    });

    expect(report.status).toBe("FAIL");
    expect(report.checks.postId.status).toBe("FAIL");
  });

  it("records body and official-link differences", async () => {
    const report = await service({
      inspection: { html: '<p>別の本文</p><a href="https://example.com/other">別リンク</a>' }
    }).execute({ blog, article, postId, postEditorUrl: editorUrl });

    expect(report.checks.body.status).toBe("FAIL");
    expect(report.checks.officialLinks.status).toBe("FAIL");
  });

  it("records missing and duplicate images", async () => {
    for (const imageCount of [0, 2]) {
      const report = await service({ inspection: { imageCount } }).execute({
        blog,
        article,
        postId,
        postEditorUrl: editorUrl
      });
      expect(report.status).toBe("FAIL");
      expect(report.checks.imageCount).toMatchObject({ status: "FAIL", actual: imageCount });
    }
  });

  it("accepts exactly one Blogger-generated leading image wrapper without treating its image link as official information", async () => {
    const wrapper =
      '<div class="separator"><a href="https://blogger.googleusercontent.com/image.png"><img data-original-height="1024" data-original-width="1536" src="https://blogger.googleusercontent.com/image.png"></a></div>';
    const report = await service({ inspection: { html: `${wrapper}${article.html}` } }).execute({
      blog,
      article,
      postId,
      postEditorUrl: editorUrl
    });
    expect(report.status).toBe("PASS");
    expect(report.checks.body.status).toBe("PASS");
    expect(report.checks.officialLinks.status).toBe("PASS");
  });

  it("does not normalize an image wrapper when the article expects no image", async () => {
    const wrapper =
      '<div class="separator"><a href="https://blogger.googleusercontent.com/image.png"><img data-original-height="1024" data-original-width="1536" src="https://blogger.googleusercontent.com/image.png"></a></div>';
    const noImageArticle = { ...article, imagePath: undefined };
    const report = await service({
      inspection: { html: `${wrapper}${article.html}`, imageCount: 1 }
    }).execute({
      blog,
      article: noImageArticle,
      postId,
      postEditorUrl: editorUrl
    });
    expect(report.status).toBe("FAIL");
    expect(report.checks.body.status).toBe("FAIL");
    expect(report.checks.imageCount.status).toBe("FAIL");
  });

  it.each(["SCHEDULED", "PUBLISHED"] as const)(
    "fails a %s post instead of treating it as a draft",
    async (postState) => {
      const report = await service({ inspection: { postState } }).execute({
        blog,
        article,
        postId,
        postEditorUrl: editorUrl
      });

      expect(report.status).toBe("FAIL");
      expect(report.checks.draftState.status).toBe("FAIL");
      expect(
        postState === "SCHEDULED" ? report.checks.scheduled.status : report.checks.published.status
      ).toBe("FAIL");
    }
  );

  it("records an old same-title draft as a duplicate", async () => {
    const report = await service({
      editUrls: [editorUrl, "https://www.blogger.com/blog/post/edit/1111111111/4444444444"]
    }).execute({
      blog,
      article,
      postId,
      postEditorUrl: editorUrl
    });

    expect(report.status).toBe("FAIL");
    expect(report.checks.duplicateTitle.status).toBe("FAIL");
  });

  it("records an unavailable Blogger read as UNVERIFIED", async () => {
    const unavailable = new ExistingDraftCompleteAuditService(
      loadConfig({}),
      () => new Date("2026-09-01T00:00:00.000Z"),
      async () => ({
        inspectExistingDraft: async () => {
          throw new Error("Blogger session is not ready");
        },
        findDrafts: async () => ({ title: article.title, editUrls: [editorUrl], count: 1 })
      })
    );

    const report = await unavailable.execute({ blog, article, postId, postEditorUrl: editorUrl });

    expect(report).toMatchObject({
      status: "UNVERIFIED",
      checks: {},
      reasons: ["Blogger draft state could not be verified"],
      finalError: "Blogger session is not ready"
    });
    expect(report.actual).toBeUndefined();
  });

  it("rejects a mismatched editor target before creating a Blogger client", async () => {
    const clientFactory = vi.fn();
    const audit = new ExistingDraftCompleteAuditService(loadConfig({}), undefined, clientFactory);

    await expect(
      audit.execute({
        blog,
        article,
        postId,
        postEditorUrl: `https://www.blogger.com/blog/post/edit/9999999999/${postId}`
      })
    ).rejects.toThrow("does not belong to configured blog");
    expect(clientFactory).not.toHaveBeenCalled();
  });
});
