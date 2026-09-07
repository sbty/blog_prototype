import { describe, expect, it } from "vitest";
import type { BlogConfig } from "../config/blogConfig.js";
import type { ArticleInput } from "../domain/article.js";
import type { ExistingDraftInspection } from "../browser/bloggerDryRun.js";
import type { PublishedPostAuditResult } from "../services/publishedPostAuditService.js";
import { PublishedPostCompleteAuditService } from "../services/publishedPostCompleteAuditService.js";

const postId = "2222222222";
const editorUrl = `https://www.blogger.com/blog/post/edit/1111111111/${postId}`;
const blog = {
  blogKey: "blog-1",
  adminUrl: "https://www.blogger.com/blog/posts/1111111111"
} as BlogConfig;
const article = {
  title: "公開完全監査テスト",
  html: '<p>本文<a href="https://example.com/source">出典</a></p>',
  labels: ["test"],
  searchDescription: "説明",
  slug: "published-complete-audit",
  imagePath: "image.png"
} as ArticleInput;
const inspection: ExistingDraftInspection = {
  blogId: "1111111111",
  postId,
  editUrl: editorUrl,
  postState: "PUBLISHED",
  title: article.title,
  html: article.html,
  labels: article.labels,
  searchDescription: article.searchDescription,
  slug: article.slug,
  imageCount: 1
};
const publicAudit: PublishedPostAuditResult = {
  postId,
  title: article.title,
  matchCount: 1,
  publicUrl: "https://example.com/post",
  publishedAt: "2026-09-01T09:00:00.000+09:00",
  updatedAt: "2026-09-01T09:00:00.000+09:00",
  contentPresent: true,
  imageCount: 1,
  imageUrl: "https://example.com/image.png",
  imageStatus: 200,
  imageBytes: 10,
  auditedAt: "2026-09-01T01:00:00.000Z"
};

function service(actual = inspection, listedTitle = article.title) {
  return new PublishedPostCompleteAuditService(
    {} as never,
    () => new Date("2026-09-01T01:00:00.000Z"),
    async () => ({
      inspectExistingDraft: async () => actual,
      listPosts: async () => ({
        blogId: "1111111111",
        posts: [
          {
            postId,
            editUrl: editorUrl,
            title: listedTitle,
            postState: "PUBLISHED",
            rowText: "公開済み"
          }
        ]
      })
    }),
    async () => publicAudit
  );
}

describe("PublishedPostCompleteAuditService", () => {
  it("checks the public page and Blogger editor fields without mutation", async () => {
    const result = await service().execute({ blog, article, postId, postEditorUrl: editorUrl });
    expect(result.status).toBe("PASS");
    expect(result.checks).toMatchObject({
      published: { status: "PASS" },
      officialLinks: { status: "PASS" },
      labels: { status: "PASS" },
      searchDescription: { status: "PASS" },
      permalink: { status: "PASS" },
      imageCount: { status: "PASS" },
      publicPage: { status: "PASS" }
    });
  });

  it("reports an editor setting mismatch as FAIL", async () => {
    const result = await service({ ...inspection, labels: [] }).execute({
      blog,
      article,
      postId,
      postEditorUrl: editorUrl
    });
    expect(result.status).toBe("FAIL");
    expect(result.checks.labels.status).toBe("FAIL");
  });

  it("accepts a confirmed public post when the editor still reports it as scheduled", async () => {
    const result = await service({ ...inspection, postState: "SCHEDULED" }).execute({
      blog,
      article,
      postId,
      postEditorUrl: editorUrl
    });
    expect(result.status).toBe("PASS");
    expect(result.checks.published).toMatchObject({ status: "PASS" });
  });

  it("normalizes only the generated leading Blogger image wrapper", async () => {
    const wrapper =
      '<div class="separator"><a href="https://blogger.googleusercontent.com/image.png"><img data-original-height="1024" data-original-width="1536" src="https://blogger.googleusercontent.com/image.png"></a></div>';
    const result = await service({ ...inspection, html: `${wrapper}${article.html}` }).execute({
      blog,
      article,
      postId,
      postEditorUrl: editorUrl
    });
    expect(result.status).toBe("PASS");
    expect(result.checks.body.status).toBe("PASS");
    expect(result.checks.officialLinks.status).toBe("PASS");
  });

  it("does not strip a non-Blogger image wrapper", async () => {
    const wrapper =
      '<div class="separator"><a href="https://example.com/image.png"><img data-original-height="1024" data-original-width="1536" src="https://example.com/image.png"></a></div>';
    const result = await service({ ...inspection, html: `${wrapper}${article.html}` }).execute({
      blog,
      article,
      postId,
      postEditorUrl: editorUrl
    });
    expect(result.status).toBe("FAIL");
    expect(result.checks.body.status).toBe("FAIL");
    expect(result.checks.officialLinks.status).toBe("FAIL");
  });

  it("does not accept an editor scheduled state when the public post ID is not confirmed", async () => {
    const mismatchedPublicAudit = { ...publicAudit, postId: "3333333333" };
    const result = await new PublishedPostCompleteAuditService(
      {} as never,
      () => new Date("2026-09-01T01:00:00.000Z"),
      async () => ({
        inspectExistingDraft: async () => ({ ...inspection, postState: "SCHEDULED" as const }),
        listPosts: async () => ({
          blogId: "1111111111",
          posts: [
            {
              postId,
              editUrl: editorUrl,
              title: article.title,
              postState: "SCHEDULED",
              rowText: "予約済み"
            }
          ]
        })
      }),
      async () => mismatchedPublicAudit
    ).execute({ blog, article, postId, postEditorUrl: editorUrl });
    expect(result.status).toBe("FAIL");
    expect(result.checks.published.status).toBe("FAIL");
    expect(result.checks.publicPostId.status).toBe("FAIL");
  });
});
