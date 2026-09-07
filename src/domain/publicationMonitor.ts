import { z } from "zod";

export const publicationMonitorBatchManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    operation: z.literal("audit-publication-monitors"),
    canonicalSelectionPath: z.string().trim().min(1),
    monitors: z
      .array(
        z
          .object({
            batch: z.string().trim().min(1),
            monitorPath: z.string().trim().min(1),
            scheduleAuditPath: z.string().trim().min(1)
          })
          .strict()
      )
      .min(1)
  })
  .strict();

export const publicationMonitorFileSchema = z
  .object({
    schemaVersion: z.number(),
    purpose: z.string(),
    status: z.string(),
    timezone: z.literal("Asia/Tokyo"),
    counts: z.record(z.string(), z.number()),
    items: z.array(
      z
        .object({
          slug: z.string().trim().min(1),
          blogKey: z.string().trim().min(1),
          postId: z.string().regex(/^\d{10,30}$/),
          scheduledAtJst: z.string().trim().min(1),
          status: z.enum(["PENDING", "PASS", "FAIL", "UNVERIFIED"]),
          auditAttempts: z.number().int().positive().optional(),
          finalError: z.string().optional(),
          auditedAt: z.string().optional(),
          auditReport: z.string().optional()
        })
        .passthrough()
    )
  })
  .passthrough();

export const publicationMonitorScheduleAuditSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            slug: z.string().trim().min(1),
            postId: z.string().regex(/^\d{10,30}$/),
            scheduledAtJst: z.string().trim().min(1)
          })
          .passthrough()
      )
      .optional(),
    targets: z
      .array(
        z
          .object({
            slug: z.string().trim().min(1),
            postId: z.string().regex(/^\d{10,30}$/),
            scheduledAtJst: z.string().trim().min(1)
          })
          .passthrough()
      )
      .optional()
  })
  .passthrough();
