import { describe, expect, it, vi } from "vitest";
import { BloggerDryRunClient } from "../browser/bloggerDryRun.js";
import type { ArticleInput } from "../domain/article.js";

const postEditorUrl =
  "https://www.blogger.com/blog/post/edit/1111111111111111111/2222222222222222222";
const article = {
  title: "キーボードトレーは必要？机の高さが合わないときの選び方と注意点",
  html: "<p>本文</p>",
  labels: ["キーボードトレー"],
  searchDescription: "説明",
  slug: "desk-gear-lab-02",
  imagePath: "C:/images/desk-gear-lab-02.png",
  scheduledAt: "2026-10-01T00:00:00.000Z"
} as ArticleInput;

describe("BloggerDryRunClient schedule persistence gate", () => {
  it("does not open a scheduling context when the reloaded draft has an empty permalink", async () => {
    const client = Object.create(BloggerDryRunClient.prototype) as {
      config: { ENABLE_SCHEDULED_POST: boolean; ENABLE_DRAFT_SAVE: boolean };
      inspectExistingDraft: ReturnType<typeof vi.fn>;
      openContext: ReturnType<typeof vi.fn>;
      schedulePost: BloggerDryRunClient["schedulePost"];
    };
    client.config = { ENABLE_SCHEDULED_POST: true, ENABLE_DRAFT_SAVE: false };
    client.inspectExistingDraft = vi.fn(async () => ({
      blogId: "1111111111111111111",
      postId: "2222222222222222222",
      editUrl: postEditorUrl,
      postState: "DRAFT" as const,
      title: article.title,
      html: article.html,
      labels: article.labels,
      searchDescription: article.searchDescription,
      slug: "",
      imageCount: 1
    }));
    client.openContext = vi.fn();

    await expect(
      client.schedulePost({
        adminUrl: "https://www.blogger.com/blog/posts/1111111111111111111",
        postEditorUrl,
        article,
        artifactDir: "unused",
        assertCanMutate: async () => undefined
      })
    ).rejects.toThrow("Scheduled post preflight refused persisted draft");
    expect(client.inspectExistingDraft).toHaveBeenCalledOnce();
    expect(client.openContext).not.toHaveBeenCalled();
  });
});
