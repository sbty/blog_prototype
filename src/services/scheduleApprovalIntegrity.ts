import { createHash } from "node:crypto";
import type { ScheduleApproval } from "./scheduleApprovalService.js";

export function calculateArtifactSha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function calculateSchedulePlanSha256(planText: string): string {
  return calculateArtifactSha256(planText);
}

export function assertScheduleApprovalIntegrity(input: {
  jobId: string;
  planText: string;
  approval: ScheduleApproval;
}): void {
  if (input.approval.jobId !== input.jobId) {
    throw new Error(
      "Schedule approval belongs to job " + input.approval.jobId + ", expected " + input.jobId
    );
  }
  const actualHash = calculateSchedulePlanSha256(input.planText);
  if (input.approval.planSha256 !== actualHash) {
    throw new Error("Schedule plan has changed since approval");
  }
  if (
    input.approval.confirmationMatched !== true ||
    input.approval.bloggerMutationPerformed !== false
  ) {
    throw new Error("Schedule approval artifact is not a valid local approval");
  }
}