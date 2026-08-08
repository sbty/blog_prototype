import { z } from "zod";

const jobIdSchema = z.string().trim().min(1).max(200);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256");

const approvalItemSchema = z
  .object({
    jobId: jobIdSchema,
    confirmation: jobIdSchema
  })
  .strict();

const executionItemSchema = approvalItemSchema.extend({
  packageSha256: sha256Schema,
  auditSha256: sha256Schema
});

export const scheduleBatchManifestSchema = z
  .discriminatedUnion("operation", [
    z
      .object({
        operation: z.literal("approve-schedules"),
        continueOnError: z.boolean().default(true),
        items: z.array(approvalItemSchema).min(1).max(500)
      })
      .strict(),
    z
      .object({
        operation: z.literal("prepare-schedules"),
        continueOnError: z.boolean().default(true),
        items: z.array(approvalItemSchema).min(1).max(500)
      })
      .strict(),
    z
      .object({
        operation: z.literal("execute-schedules"),
        continueOnError: z.boolean().default(true),
        items: z.array(executionItemSchema).min(1).max(500)
      })
      .strict()
  ])
  .superRefine((manifest, context) => {
    const jobIds = new Set<string>();
    manifest.items.forEach((item, index) => {
      if (item.confirmation !== item.jobId) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "confirmation"],
          message: "Confirmation must exactly match the job ID"
        });
      }
      if (jobIds.has(item.jobId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "jobId"],
          message: `Duplicate schedule job: ${item.jobId}`
        });
      }
      jobIds.add(item.jobId);
    });
  });

export type ScheduleBatchManifest = z.infer<typeof scheduleBatchManifestSchema>;
export type ScheduleBatchItem = ScheduleBatchManifest["items"][number];
