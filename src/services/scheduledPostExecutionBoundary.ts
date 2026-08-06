export interface ScheduledPostExecutionRequest {
  jobId: string;
  confirmation: string;
  packageSha256: string;
  auditSha256: string;
}

export function denyScheduledPostExecution(input: ScheduledPostExecutionRequest): never {
  void input;
  throw new Error(
    "Scheduled post execution is not implemented or authorized; Blogger mutation remains disabled"
  );
}
