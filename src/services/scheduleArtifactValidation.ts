import { z } from "zod";

export const canonicalUtcTimestamp = z.string().refine((value) => {
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
});

export const schedulePlanArtifactSchema = z
  .object({
    scheduledAt: canonicalUtcTimestamp,
    date: z.string().regex(/^\d{4}\/\d{2}\/\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    timezone: z.string().min(1),
    mode: z.literal("local-plan"),
    bloggerMutationPerformed: z.literal(false),
    quota: z
      .object({
        systemCount: z.number().int().nonnegative(),
        systemLimit: z.number().int().positive(),
        blogCount: z.number().int().nonnegative(),
        blogLimit: z.number().int().positive()
      })
      .strict()
  })
  .strict()
  .superRefine((plan, context) => {
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: plan.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).formatToParts(new Date(plan.scheduledAt));
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timezone"],
        message: "Invalid timezone"
      });
      return;
    }
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    if (`${value("year")}/${value("month")}/${value("day")}` !== plan.date) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["date"],
        message: "Date does not match scheduledAt and timezone"
      });
    }
    if (`${value("hour")}:${value("minute")}` !== plan.time) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["time"],
        message: "Time does not match scheduledAt and timezone"
      });
    }    if (plan.quota.systemCount >= plan.quota.systemLimit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quota", "systemCount"],
        message: "System quota has no available slot"
      });
    }
    if (plan.quota.blogCount >= plan.quota.blogLimit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quota", "blogCount"],
        message: "Blog quota has no available slot"
      });
    }
  });

export const scheduleApprovalArtifactSchema = z
  .object({
    jobId: z.string().min(1),
    approvedAt: canonicalUtcTimestamp,
    confirmationMatched: z.literal(true),
    bloggerMutationPerformed: z.literal(false),
    planSha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();
export const scheduleReadinessResultSchema = z
  .object({
    jobId: z.string().min(1),
    checkedAt: canonicalUtcTimestamp,
    planSha256: z.string().regex(/^[a-f0-9]{64}$/),
    localChecksPassed: z.literal(true),
    executionEnabled: z.literal(false),
    executionAuthorized: z.literal(false),
    bloggerMutationPerformed: z.literal(false),
    quota: z
      .object({
        systemCount: z.number().int().nonnegative(),
        systemLimit: z.number().int().positive(),
        blogCount: z.number().int().nonnegative(),
        blogLimit: z.number().int().positive()
      })
      .strict()
  })
  .strict()
  .superRefine((result, context) => {
    if (result.quota.systemCount > result.quota.systemLimit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quota", "systemCount"],
        message: "System quota is exceeded"
      });
    }
    if (result.quota.blogCount > result.quota.blogLimit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quota", "blogCount"],
        message: "Blog quota is exceeded"
      });
    }
  });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const schedulePreviewArtifactSchema = z
  .object({
    jobId: z.string().min(1),
    readiness: scheduleReadinessResultSchema,
    dryRun: z
      .object({
        screenshotPath: z.string().min(1),
        currentUrl: z.string().url(),
        publishButtonVisible: z.boolean(),
        postSettings: z
          .object({
            labels: z.array(z.string()),
            searchDescription: z.string(),
            slug: z.string(),
            applied: z.literal(true)
          })
          .strict(),
        schedulePreview: z
          .object({
            scheduledAt: canonicalUtcTimestamp,
            date: z.string().min(1),
            time: z.string().min(1),
            timezone: z.string().min(1)
          })
          .strict(),
        networkGuard: z
          .object({
            blockedMutationRequests: z.number().int().nonnegative(),
            blockedRequests: z.array(
              z.object({ method: z.string().min(1), url: z.string().min(1) }).strict()
            ),
            blockedRequestLogTruncated: z.boolean()
          })
          .strict()
      })
      .strict(),
    bloggerMutationPerformed: z.literal(false),
    executionAuthorized: z.literal(false),
    evidence: z
      .object({
        previewedAt: canonicalUtcTimestamp,
        planSha256: sha256Schema,
        approvalSha256: sha256Schema,
        screenshotSha256: sha256Schema
      })
      .strict()
  })
  .strict();

export const schedulePreviewConfirmationArtifactSchema = z
  .object({
    artifactType: z.literal("schedule-preview-confirmation"),
    schemaVersion: z.literal(1),
    jobId: z.string().min(1),
    confirmedAt: canonicalUtcTimestamp,
    previewSha256: sha256Schema,
    confirmationMatched: z.literal(true),
    executionEnabled: z.literal(false),
    executionAuthorized: z.literal(false),
    bloggerMutationPerformed: z.literal(false)
  })
  .strict();
export const scheduleExecutionPackageArtifactSchema = z
  .object({
    artifactType: z.literal("schedule-execution-package"),
    schemaVersion: z.literal(1),
    jobId: z.string().min(1),
    preparedAt: canonicalUtcTimestamp,
    evidence: z
      .object({
        planSha256: sha256Schema,
        approvalSha256: sha256Schema,
        previewSha256: sha256Schema,
        previewConfirmationSha256: sha256Schema,
        screenshotSha256: sha256Schema
      })
      .strict(),
    evidenceChainValid: z.literal(true),
    executionEnabled: z.literal(false),
    executionAuthorized: z.literal(false),
    bloggerMutationPerformed: z.literal(false),
    requiresExternalExecutionImplementation: z.literal(true)
  })
  .strict();
export const scheduleExecutionPackageAuditArtifactSchema = z
  .object({
    artifactType: z.literal("schedule-execution-package-audit"),
    schemaVersion: z.literal(1),
    jobId: z.string().min(1),
    auditedAt: canonicalUtcTimestamp,
    packageSha256: sha256Schema,
    evidenceChainValid: z.literal(true),
    executionEnabled: z.literal(false),
    executionAuthorized: z.literal(false),
    bloggerMutationPerformed: z.literal(false)
  })
  .strict();
export function assertSchedulePreviewMatchesPlan(
  plan: z.infer<typeof schedulePlanArtifactSchema>,
  preview: z.infer<typeof schedulePreviewArtifactSchema>,
  message = "Schedule preview does not match the approved schedule plan"
): void {
  const schedulePreview = preview.dryRun.schedulePreview;
  if (
    schedulePreview.scheduledAt !== plan.scheduledAt ||
    schedulePreview.date !== plan.date ||
    schedulePreview.time !== plan.time ||
    schedulePreview.timezone !== plan.timezone
  ) {
    throw new Error(message);
  }
}
export function assertScheduleQuotaPolicyMatchesReadiness(
  plan: z.infer<typeof schedulePlanArtifactSchema>,
  readiness: z.infer<typeof scheduleReadinessResultSchema>,
  message = "Schedule readiness quota policy does not match the approved plan"
): void {
  if (
    readiness.quota.systemLimit !== plan.quota.systemLimit ||
    readiness.quota.blogLimit !== plan.quota.blogLimit
  ) {
    throw new Error(message);
  }
}
export function assertTimestampSequenceBeforeSchedule(
  timestamps: readonly string[],
  scheduledAt: string,
  message: string
): void {
  const values = timestamps.map((value) => Date.parse(value));
  const scheduledValue = Date.parse(scheduledAt);
  if (
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(scheduledValue) ||
    values.some((value, index) => index > 0 && values[index - 1] > value) ||
    values[values.length - 1] >= scheduledValue
  ) {
    throw new Error(message);
  }
}