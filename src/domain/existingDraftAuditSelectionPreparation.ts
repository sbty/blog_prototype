import { z } from "zod";

const path = z.string().trim().min(1).max(4096);
const postId = z.string().regex(/^\d{10,30}$/);

export const existingDraftAuditSelectionPreparationManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    operation: z.literal("prepare-existing-draft-audit-selection"),
    items: z
      .array(
        z
          .object({
            batch: z.string().trim().min(1),
            blogKey: z.string().trim().min(1),
            slug: z.string().trim().min(1),
            title: z.string().trim().min(1),
            blogPath: path,
            articlePath: path,
            postId,
            postEditorUrl: z.string().url(),
            scheduledAtJst: z.string().trim().min(1).optional(),
            provenance: z
              .object({
                generationPackage: path,
                saveAudit: path,
                reservationAudit: path,
                readinessAudit: path
              })
              .strict(),
            evidence: z
              .object({
                save: z.literal("PASS"),
                reservation: z.literal("PASS"),
                readiness: z.literal("PASS")
              })
              .strict()
          })
          .strict()
      )
      .max(100)
  })
  .strict();

export type ExistingDraftAuditSelectionPreparationManifest = z.infer<
  typeof existingDraftAuditSelectionPreparationManifestSchema
>;
