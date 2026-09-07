import { z } from "zod";

const pathSchema = z.string().trim().min(1).max(4096);
const postIdSchema = z.string().regex(/^\d{10,30}$/, "Blogger post ID must be numeric");
const editUrlSchema = z.string().url().max(4096);

export const existingDraftAuditBatchManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    operation: z.literal("audit-existing-drafts"),
    items: z
      .array(
        z
          .object({
            blogPath: pathSchema,
            articlePath: pathSchema,
            postId: postIdSchema,
            postEditorUrl: editUrlSchema,
            slug: z.string().trim().min(1).max(100)
          })
          .strict()
      )
      .min(1)
      .max(50)
  })
  .strict()
  .superRefine((manifest, context) => {
    const postIds = new Set<string>();
    const editorUrls = new Set<string>();
    manifest.items.forEach((item, index) => {
      if (postIds.has(item.postId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "postId"],
          message: `Duplicate postId: ${item.postId}`
        });
      }
      postIds.add(item.postId);
      if (editorUrls.has(item.postEditorUrl)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "postEditorUrl"],
          message: `Duplicate postEditorUrl: ${item.postEditorUrl}`
        });
      }
      editorUrls.add(item.postEditorUrl);
    });
  });

export type ExistingDraftAuditBatchManifest = z.infer<typeof existingDraftAuditBatchManifestSchema>;
