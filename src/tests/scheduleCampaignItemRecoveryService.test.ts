import { describe, expect, it, vi } from "vitest";
import { blogConfigSchema } from "../config/blogConfig.js";
import { articleInputSchema } from "../domain/article.js";
import type { JobRecord } from "../domain/job.js";
import { ScheduleCampaignItemRecoveryService } from "../services/scheduleCampaignItemRecoveryService.js";

const blog = blogConfigSchema.parse({
  blogKey: "blog-1",
  displayName: "Blog 1",
  adminUrl: "https://www.blogger.com/blog/posts/1111111111",
  primaryTheme: "testing"
});
const article = articleInputSchema.parse({
  title: "Article",
  html: "<p>Article</p>",
  labels: ["test"],
  searchDescription: "Description",
  slug: "article",
  scheduledAt: "2026-08-20T00:00:00.000Z"
});
const evidence = {
  previewSha256: "1".repeat(64),
  previewConfirmationSha256: "2".repeat(64),
  packageSha256: "3".repeat(64),
  auditSha256: "4".repeat(64)
};

function fixture(status: JobRecord["status"] = "READY_FOR_POST") {
  const job: JobRecord = {
    id: "job-1",
    blogKey: blog.blogKey,
    mode: "schedule",
    status,
    payloadJson: JSON.stringify(article),
    artifactDir: "C:/tmp/job-1",
    error: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  };
  const approve = vi.fn(async () => ({}));
  const prepare = vi.fn(async () => evidence);
  const jobs = { find: vi.fn((jobId: string) => (jobId === job.id ? job : null)) };
  const blogs = {
    findConfig: vi.fn((blogKey: string) => (blogKey === blog.blogKey ? blog : null))
  };
  const service = new ScheduleCampaignItemRecoveryService({ jobs, blogs }, { approve, prepare });
  return { service, approve, prepare, job, blogs };
}

describe("ScheduleCampaignItemRecoveryService", () => {
  it("continues a ready job through approval and evidence preparation", async () => {
    const { service, approve, prepare } = fixture();
    await expect(service.execute({ jobId: "job-1", blog, article })).resolves.toEqual(evidence);
    expect(approve).toHaveBeenCalledWith({ jobId: "job-1", confirmation: "job-1" });
    expect(prepare).toHaveBeenCalledWith({ jobId: "job-1", confirmation: "job-1" });
  });

  it.each(["APPROVED_FOR_POST", "PREVIEW_CONFIRMED"] as const)(
    "continues %s without approving twice",
    async (status) => {
      const { service, approve, prepare } = fixture(status);
      await expect(service.execute({ jobId: "job-1", blog, article })).resolves.toEqual(evidence);
      expect(approve).not.toHaveBeenCalled();
      expect(prepare).toHaveBeenCalledOnce();
    }
  );

  it("rejects changed blog or article inputs", async () => {
    const changedBlog = fixture();
    await expect(
      changedBlog.service.execute({
        jobId: "job-1",
        blog: { ...blog, displayName: "Changed" },
        article
      })
    ).rejects.toThrow("blog does not match");
    expect(changedBlog.approve).not.toHaveBeenCalled();

    const changedArticle = fixture();
    await expect(
      changedArticle.service.execute({
        jobId: "job-1",
        blog,
        article: { ...article, title: "Changed" }
      })
    ).rejects.toThrow("article does not match");
    expect(changedArticle.approve).not.toHaveBeenCalled();
  });

  it("rejects terminal job states", async () => {
    const { service, prepare } = fixture("CANCELLED");
    await expect(service.execute({ jobId: "job-1", blog, article })).rejects.toThrow(
      "cannot resume job status"
    );
    expect(prepare).not.toHaveBeenCalled();
  });
});
