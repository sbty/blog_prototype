import { batchManifestSchema, type BatchManifest } from "../domain/batch.js";
import { contentBatchAuditResultSchema } from "./contentBatchAuditService.js";

export interface ContentAuditRetryResult {
  manifest: BatchManifest;
  failedAssignments: Array<{
    index: number;
    blogKey: string;
    slug: string;
    issueCodes: string[];
  }>;
}

export class ContentAuditRetryService {
  execute(batchInput: unknown, auditInput: unknown): ContentAuditRetryResult {
    const batch = batchManifestSchema.parse(batchInput);
    const audit = contentBatchAuditResultSchema.parse(auditInput);
    if (batch.operation !== "save-drafts") {
      throw new Error("Content audit retry requires a save-drafts batch");
    }
    if (audit.status !== "FAIL") {
      throw new Error("A passing content audit does not need a retry batch");
    }
    if (audit.items.length !== batch.items.length) {
      throw new Error("Content audit does not cover the complete source batch");
    }

    audit.items.forEach((audited, index) => {
      const source = batch.items[index];
      if (
        audited.index !== index ||
        audited.blogKey !== source.blogKey ||
        audited.slug !== source.article.slug
      ) {
        throw new Error(`Content audit item does not match source batch index ${index}`);
      }
    });

    const failedAuditItems = audit.items.filter((item) => item.status === "FAIL");
    const failedIndexes = new Set(failedAuditItems.map((item) => item.index));
    const retryItems = batch.items.filter((_, index) => failedIndexes.has(index));
    const retryBlogKeys = new Set(retryItems.map((item) => item.blogKey));
    const manifest = batchManifestSchema.parse({
      ...batch,
      blogs: batch.blogs.filter((blog) => retryBlogKeys.has(blog.blogKey)),
      items: retryItems
    });

    return {
      manifest,
      failedAssignments: failedAuditItems.map((item) => ({
        index: item.index,
        blogKey: item.blogKey,
        slug: item.slug,
        issueCodes: [...new Set(item.issues.map((issue) => issue.code))]
      }))
    };
  }
}
