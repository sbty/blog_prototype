import { z } from "zod";

const pathSchema = z.string().trim().min(1).max(4096);
const postIdSchema = z.string().regex(/^\d{10,30}$/, "Blogger post ID must be numeric");
const editUrlSchema = z.string().url().max(4096);

export const existingDraftAuditSelectionManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    operation: z.literal("select-existing-draft-audit-targets"),
    items: z
      .array(
        z
          .object({
            batch: z.string().trim().min(1).max(100),
            blogPath: pathSchema,
            articlePath: pathSchema,
            postId: postIdSchema,
            postEditorUrl: editUrlSchema,
            slug: z.string().trim().min(1).max(100)
          })
          .strict()
      )
      .max(100)
  })
  .strict();

export type ExistingDraftAuditSelectionManifest = z.infer<
  typeof existingDraftAuditSelectionManifestSchema
>;
