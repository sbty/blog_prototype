import { describe, expect, it } from "vitest";
import {
  assertScheduleApprovalIntegrity,
  calculateSchedulePlanSha256
} from "../services/scheduleApprovalIntegrity.js";

const planText = JSON.stringify({ mode: "local-plan", scheduledAt: "2026-08-01T00:00:00Z" });
const approval = {
  jobId: "job-1",
  approvedAt: "2026-07-30T00:00:00.000Z",
  confirmationMatched: true as const,
  bloggerMutationPerformed: false as const,
  planSha256: calculateSchedulePlanSha256(planText)
};

describe("schedule approval integrity", () => {
  it("accepts the exact approved plan bytes", () => {
    expect(() =>
      assertScheduleApprovalIntegrity({ jobId: "job-1", planText, approval })
    ).not.toThrow();
    expect(approval.planSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a modified plan", () => {
    expect(() =>
      assertScheduleApprovalIntegrity({
        jobId: "job-1",
        planText: `${planText} `,
        approval
      })
    ).toThrow("changed since approval");
  });

  it("rejects an approval for another job", () => {
    expect(() =>
      assertScheduleApprovalIntegrity({ jobId: "job-2", planText, approval })
    ).toThrow("belongs to job");
  });
});