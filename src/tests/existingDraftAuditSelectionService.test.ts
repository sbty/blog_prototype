import { describe, expect, it } from "vitest";
import type { BlogConfig } from "../config/blogConfig.js";
import type { ArticleInput } from "../domain/article.js";
import {
  ExistingDraftAuditSelectionService,
  type ExistingDraftAuditSelectionItemInput
} from "../services/existingDraftAuditSelectionService.js";

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
  title: "下書き選定テスト",
  html: "<p>本文</p>",
  labels: [],
  searchDescription: "説明",
  slug: "draft-selection-test"
} as ArticleInput;
const item: ExistingDraftAuditSelectionItemInput = {
  batch: "third",
  blogPath: "blog.json",
  articlePath: "article.json",
  postId,
  postEditorUrl: editorUrl,
  slug: article.slug,
  blog,
  article
};

function service(
  input: {
    listState?: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "UNKNOWN";
    editorState?: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "UNKNOWN";
    publishedAt?: string;
    duplicate?: boolean;
    editorPostId?: string;
  } = {}
) {
  const listState = input.listState ?? "DRAFT";
  const posts = [
    { postId, editUrl: editorUrl, title: article.title, postState: listState, rowText: listState },
    ...(input.duplicate
      ? [
          {
            postId: "3333333333",
            editUrl: "https://www.blogger.com/blog/post/edit/1111111111/3333333333",
            title: article.title,
            postState: "DRAFT" as const,
            rowText: "DRAFT"
          }
        ]
      : [])
  ];
  return new ExistingDraftAuditSelectionService(
    {
      listPosts: async () => ({ blogId: "1111111111", posts }),
      inspectExistingDraft: async () => ({
        blogId: "1111111111",
        postId: input.editorPostId ?? postId,
        editUrl: editorUrl,
        postState: input.editorState ?? "DRAFT",
        publishedAt: input.publishedAt,
        title: article.title,
        html: article.html,
        labels: [],
        searchDescription: article.searchDescription,
        slug: article.slug,
        imageCount: 0
      })
    },
    () => new Date("2026-09-01T00:00:00.000Z")
  );
}

describe("ExistingDraftAuditSelectionService", () => {
  it("excludes a list draft when the fresh editor has a future publish date", async () => {
    const report = await service({ publishedAt: "2026/10/14 9:00" }).execute({ items: [item] });
    expect(report.status).toBe("NO_ELIGIBLE_TARGETS");
    expect(report.decisions[0]).toMatchObject({
      listState: "DRAFT",
      editorState: "DRAFT",
      decision: "EXCLUDED"
    });
    expect(report.decisions[0].reason).toContain("future publish date");
    expect(report.auditManifest).toBeNull();
  });

  it("selects an unscheduled unpublished draft and creates a batch-audit manifest", async () => {
    const report = await service().execute({ items: [item] });
    expect(report.status).toBe("TARGETS_SELECTED");
    expect(report.auditManifest?.items).toEqual([
      {
        blogPath: "blog.json",
        articlePath: "article.json",
        postId,
        postEditorUrl: editorUrl,
        slug: article.slug
      }
    ]);
  });

  it.each(["PUBLISHED", "SCHEDULED", "UNKNOWN"] as const)(
    "excludes a %s post-list entry without opening the editor",
    async (listState) => {
      const report = await service({ listState }).execute({ items: [item] });
      expect(report.decisions[0]).toMatchObject({ listState, decision: "EXCLUDED" });
      expect(report.decisions[0].editorState).toBeUndefined();
    }
  );

  it("excludes an editor post-ID mismatch", async () => {
    const report = await service({ editorPostId: "3333333333" }).execute({ items: [item] });
    expect(report.decisions[0].reason).toContain("identity");
  });

  it("excludes same-title duplicates", async () => {
    const report = await service({ duplicate: true }).execute({ items: [item] });
    expect(report.decisions[0].reason).toContain("Same-title duplicate");
  });

  it("writes a valid empty selection report without browser access", async () => {
    const report = await service().execute({ items: [] });
    expect(report).toMatchObject({
      status: "NO_ELIGIBLE_TARGETS",
      counts: { localCanonical: 0, selected: 0, excluded: 0, unverified: 0 },
      auditManifest: null
    });
  });

  it("retries a transient post-list timeout before selecting a draft", async () => {
    let listCalls = 0;
    const selection = new ExistingDraftAuditSelectionService(
      {
        listPosts: async () => {
          listCalls += 1;
          if (listCalls === 1) throw new Error("net::ERR_CONNECTION_TIMED_OUT");
          return {
            blogId: "1111111111",
            posts: [
              {
                postId,
                editUrl: editorUrl,
                title: article.title,
                postState: "DRAFT" as const,
                rowText: "Draft"
              }
            ]
          };
        },
        inspectExistingDraft: async () => ({
          blogId: "1111111111",
          postId,
          editUrl: editorUrl,
          postState: "DRAFT" as const,
          title: article.title,
          html: article.html,
          labels: [],
          searchDescription: article.searchDescription,
          slug: article.slug,
          imageCount: 0
        })
      },
      () => new Date("2026-09-01T00:00:00.000Z"),
      { maxAttempts: 2, retryDelayMs: 0 }
    );

    const report = await selection.execute({ items: [item] });

    expect(report).toMatchObject({
      status: "TARGETS_SELECTED",
      counts: { selected: 1, unverified: 0 }
    });
    expect(report.decisions[0]).toMatchObject({
      decision: "SELECTED",
      listAttempts: 2,
      editorAttempts: 1
    });
  });

  it("records a permanently unreachable post list as UNVERIFIED without an audit manifest", async () => {
    const selection = new ExistingDraftAuditSelectionService(
      {
        listPosts: async () => {
          throw new Error("net::ERR_CONNECTION_TIMED_OUT");
        },
        inspectExistingDraft: async () => {
          throw new Error("must not inspect without a list");
        }
      },
      () => new Date("2026-09-01T00:00:00.000Z"),
      { maxAttempts: 2, retryDelayMs: 0 }
    );

    const report = await selection.execute({ items: [item] });

    expect(report).toMatchObject({
      status: "SELECTION_INCOMPLETE",
      counts: { selected: 0, excluded: 0, unverified: 1 },
      auditManifest: null
    });
    expect(report.decisions[0]).toMatchObject({
      decision: "UNVERIFIED",
      listState: "UNVERIFIED",
      listAttempts: 2,
      finalError: "net::ERR_CONNECTION_TIMED_OUT"
    });
  });

  it("retries a transient editor closure and excludes an unverified blog from an otherwise valid manifest", async () => {
    const secondPostId = "4444444444";
    const secondEditorUrl = `https://www.blogger.com/blog/post/edit/3333333333/${secondPostId}`;
    const secondBlog = {
      ...blog,
      blogKey: "blog-2",
      adminUrl: "https://www.blogger.com/blog/posts/3333333333"
    };
    const secondArticle = { ...article, title: "別の下書き", slug: "second-draft-selection-test" };
    const secondItem: ExistingDraftAuditSelectionItemInput = {
      ...item,
      blogPath: "blog-2.json",
      articlePath: "article-2.json",
      postId: secondPostId,
      postEditorUrl: secondEditorUrl,
      slug: secondArticle.slug,
      blog: secondBlog,
      article: secondArticle
    };
    let editorCalls = 0;
    const selection = new ExistingDraftAuditSelectionService(
      {
        listPosts: async ({ adminUrl }) => {
          if (adminUrl === blog.adminUrl) throw new Error("net::ERR_CONNECTION_TIMED_OUT");
          return {
            blogId: "3333333333",
            posts: [
              {
                postId: secondPostId,
                editUrl: secondEditorUrl,
                title: secondArticle.title,
                postState: "DRAFT" as const,
                rowText: "Draft"
              }
            ]
          };
        },
        inspectExistingDraft: async () => {
          editorCalls += 1;
          if (editorCalls === 1) throw new Error("Target page, context or browser has been closed");
          return {
            blogId: "3333333333",
            postId: secondPostId,
            editUrl: secondEditorUrl,
            postState: "DRAFT" as const,
            title: secondArticle.title,
            html: secondArticle.html,
            labels: [],
            searchDescription: secondArticle.searchDescription,
            slug: secondArticle.slug,
            imageCount: 0
          };
        }
      },
      () => new Date("2026-09-01T00:00:00.000Z"),
      { maxAttempts: 2, retryDelayMs: 0 }
    );

    const report = await selection.execute({ items: [item, secondItem] });

    expect(report).toMatchObject({
      status: "TARGETS_SELECTED",
      counts: { selected: 1, excluded: 0, unverified: 1 }
    });
    expect(report.auditManifest?.items).toEqual([
      {
        blogPath: "blog-2.json",
        articlePath: "article-2.json",
        postId: secondPostId,
        postEditorUrl: secondEditorUrl,
        slug: secondArticle.slug
      }
    ]);
    expect(report.decisions.find((decision) => decision.slug === article.slug)).toMatchObject({
      decision: "UNVERIFIED",
      listAttempts: 2
    });
    expect(report.decisions.find((decision) => decision.slug === secondArticle.slug)).toMatchObject(
      { decision: "SELECTED", editorAttempts: 2 }
    );
  });
});
