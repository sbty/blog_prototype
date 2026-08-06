import { describe, expect, it } from "vitest";
import {
  assertSchedulePreviewMatchesPlan,
  assertScheduleQuotaPolicyMatchesReadiness,
  assertTimestampSequenceBeforeSchedule,
  schedulePlanArtifactSchema,
  schedulePreviewArtifactSchema,
  scheduleReadinessResultSchema
} from "../services/scheduleArtifactValidation.js";

const sha = "a".repeat(64);
function fixture() {
  const plan = schedulePlanArtifactSchema.parse({
    scheduledAt: "2026-08-02T00:00:00.000Z",
    date: "2026/08/02",
    time: "09:00",
    timezone: "Asia/Tokyo",
    mode: "local-plan",
    bloggerMutationPerformed: false,
    quota: { systemCount: 1, systemLimit: 3, blogCount: 0, blogLimit: 1 }
  });
  const preview = schedulePreviewArtifactSchema.parse({
    jobId: "schedule-job",
    readiness: {
      jobId: "schedule-job",
      checkedAt: "2026-08-01T00:00:00.000Z",
      planSha256: sha,
      localChecksPassed: true,
      executionEnabled: false,
      executionAuthorized: false,
      bloggerMutationPerformed: false,
      quota: { systemCount: 1, systemLimit: 3, blogCount: 1, blogLimit: 1 }
    },
    dryRun: {
      screenshotPath: "data/jobs/schedule-job/screenshots/preview.png",
      currentUrl: "https://www.blogger.com/blog/post/edit/123/456",
      publishButtonVisible: true,
      postSettings: {
        labels: [],
        searchDescription: "description",
        slug: "post",
        applied: true
      },
      schedulePreview: {
        scheduledAt: plan.scheduledAt,
        date: plan.date,
        time: plan.time,
        timezone: plan.timezone
      },
      networkGuard: {
        blockedMutationRequests: 0,
        blockedRequests: [],
        blockedRequestLogTruncated: false
      }
    },
    bloggerMutationPerformed: false,
    executionAuthorized: false,
    evidence: {
      previewedAt: "2026-08-01T01:00:00.000Z",
      planSha256: sha,
      approvalSha256: sha,
      screenshotSha256: sha
    }
  });
  return { plan, preview };
}

describe("schedulePlanArtifactSchema calendar consistency", () => {
  it("accepts local date and time derived from scheduledAt and timezone", () => {
    const { plan } = fixture();
    expect(schedulePlanArtifactSchema.safeParse(plan).success).toBe(true);
  });

  it.each([
    ["date", "2026/08/03"],
    ["time", "09:01"]
  ] as const)("rejects an internally inconsistent %s", (field, value) => {
    const { plan } = fixture();
    expect(schedulePlanArtifactSchema.safeParse({ ...plan, [field]: value }).success).toBe(false);
  });

  it("rejects an invalid IANA timezone", () => {
    const { plan } = fixture();
    expect(
      schedulePlanArtifactSchema.safeParse({ ...plan, timezone: "Invalid/Timezone" }).success
    ).toBe(false);
  });
});
describe("schedule quota artifact consistency", () => {
  it.each(["system", "blog"] as const)(
    "rejects a plan with no available %s quota slot",
    (scope) => {
      const { plan } = fixture();
      const quota = { ...plan.quota };
      if (scope === "system") quota.systemCount = quota.systemLimit;
      else quota.blogCount = quota.blogLimit;
      expect(schedulePlanArtifactSchema.safeParse({ ...plan, quota }).success).toBe(false);
    }
  );

  it("allows readiness at the limit but rejects exceeded quota", () => {
    const { preview } = fixture();
    expect(scheduleReadinessResultSchema.safeParse(preview.readiness).success).toBe(true);
    expect(
      scheduleReadinessResultSchema.safeParse({
        ...preview.readiness,
        quota: { ...preview.readiness.quota, blogCount: 2 }
      }).success
    ).toBe(false);
  });
});
describe("execution authorization denial artifacts", () => {
  it("rejects readiness that claims execution authorization", () => {
    const { preview } = fixture();
    expect(
      scheduleReadinessResultSchema.safeParse({
        ...preview.readiness,
        executionAuthorized: true
      }).success
    ).toBe(false);
  });

  it("rejects a browser preview that claims execution authorization", () => {
    const { preview } = fixture();
    expect(
      schedulePreviewArtifactSchema.safeParse({ ...preview, executionAuthorized: true }).success
    ).toBe(false);
  });
});
describe("assertScheduleQuotaPolicyMatchesReadiness", () => {
  it("accepts matching system and blog quota limits", () => {
    const { plan, preview } = fixture();
    expect(() =>
      assertScheduleQuotaPolicyMatchesReadiness(plan, preview.readiness)
    ).not.toThrow();
  });

  it.each(["systemLimit", "blogLimit"] as const)(
    "rejects a mismatched %s",
    (field) => {
      const { plan, preview } = fixture();
      preview.readiness.quota[field] += 1;
      expect(() =>
        assertScheduleQuotaPolicyMatchesReadiness(plan, preview.readiness)
      ).toThrow("quota policy does not match");
    }
  );
});
describe("assertSchedulePreviewMatchesPlan", () => {
  it("accepts an exact semantic schedule match", () => {
    const { plan, preview } = fixture();
    expect(() => assertSchedulePreviewMatchesPlan(plan, preview)).not.toThrow();
  });

  it.each([
    ["scheduledAt", "2026-08-02T00:01:00.000Z"],
    ["date", "2026/08/03"],
    ["time", "09:01"],
    ["timezone", "UTC"]
  ] as const)("rejects a mismatched %s", (field, value) => {
    const { plan, preview } = fixture();
    preview.dryRun.schedulePreview[field] = value;
    expect(() => assertSchedulePreviewMatchesPlan(plan, preview)).toThrow(
      "does not match the approved schedule plan"
    );
  });
});
describe("assertTimestampSequenceBeforeSchedule", () => {
  it("accepts a nondecreasing evidence chain before the scheduled time", () => {
    expect(() =>
      assertTimestampSequenceBeforeSchedule(
        [
          "2026-08-01T00:00:00.000Z",
          "2026-08-01T00:00:00.000Z",
          "2026-08-01T01:00:00.000Z"
        ],
        "2026-08-02T00:00:00.000Z",
        "invalid order"
      )
    ).not.toThrow();
  });

  it("rejects evidence that moves backwards", () => {
    expect(() =>
      assertTimestampSequenceBeforeSchedule(
        ["2026-08-01T01:00:00.000Z", "2026-08-01T00:00:00.000Z"],
        "2026-08-02T00:00:00.000Z",
        "invalid order"
      )
    ).toThrow("invalid order");
  });

  it("rejects evidence recorded at or after the scheduled time", () => {
    expect(() =>
      assertTimestampSequenceBeforeSchedule(
        ["2026-08-02T00:00:00.000Z"],
        "2026-08-02T00:00:00.000Z",
        "invalid order"
      )
    ).toThrow("invalid order");
  });

  it("rejects empty or malformed timestamp chains", () => {
    expect(() =>
      assertTimestampSequenceBeforeSchedule([], "2026-08-02T00:00:00.000Z", "invalid order")
    ).toThrow("invalid order");
    expect(() =>
      assertTimestampSequenceBeforeSchedule(
        ["not-a-time"],
        "2026-08-02T00:00:00.000Z",
        "invalid order"
      )
    ).toThrow("invalid order");
  });
});