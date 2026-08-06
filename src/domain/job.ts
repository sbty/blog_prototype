export const jobStatuses = [
  "PENDING",
  "RUNNING",
  "READY_FOR_POST",
  "APPROVED_FOR_POST",
  "PREVIEW_CONFIRMED",
  "CANCELLED",
  "DRY_RUN_DONE",
  "DRAFT_SAVED",
  "FAILED",
  "STOPPED"
] as const;

export type JobStatus = (typeof jobStatuses)[number];

export const jobModes = ["dry-run", "draft", "schedule"] as const;

export type JobMode = (typeof jobModes)[number];

export interface JobRecord {
  id: string;
  blogKey: string;
  mode: JobMode;
  status: JobStatus;
  payloadJson: string;
  artifactDir: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobEvent {
  id: number;
  jobId: string;
  eventType: string;
  message: string;
  metadataJson: string;
  createdAt: string;
}

export function validatePersistedJob(job: JobRecord): JobRecord {
  if (!jobModes.includes(job.mode)) {
    throw new Error(`Invalid persisted job mode for ${job.id}: ${String(job.mode)}`);
  }
  if (!jobStatuses.includes(job.status)) {
    throw new Error(`Invalid persisted job status for ${job.id}: ${String(job.status)}`);
  }
  try {
    JSON.parse(job.payloadJson);
  } catch {
    throw new Error(`Invalid persisted job payload JSON for ${job.id}`);
  }
  return job;
}

const modeCompletionStatus: Record<JobMode, JobStatus> = {
  "dry-run": "DRY_RUN_DONE",
  draft: "DRAFT_SAVED",
  schedule: "READY_FOR_POST"
};

export function assertValidJobTransition(
  mode: JobMode,
  from: JobStatus,
  to: JobStatus
): void {
  const allowed = new Set<JobStatus>();
  if (from === "PENDING") allowed.add("RUNNING");
  if (from === "RUNNING") allowed.add(modeCompletionStatus[mode]);
  if (mode === "schedule" && from === "READY_FOR_POST") {
    allowed.add("APPROVED_FOR_POST");
    allowed.add("CANCELLED");
  }
  if (mode === "schedule" && from === "APPROVED_FOR_POST") {
    allowed.add("PREVIEW_CONFIRMED");
    allowed.add("CANCELLED");
  }
  if (mode === "schedule" && from === "PREVIEW_CONFIRMED") {
    allowed.add("CANCELLED");
  }
  if (!allowed.has(to)) {
    throw new Error("Invalid " + mode + " job transition: " + from + " -> " + to);
  }
}