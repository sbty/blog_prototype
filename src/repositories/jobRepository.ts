import {
  assertValidJobTransition,
  jobModes,
  validatePersistedJob,
  type JobMode,
  type JobRecord,
  type JobStatus
} from "../domain/job.js";
import { nowIso } from "../utils/time.js";
import type { SqliteDatabase } from "./database.js";

export class JobRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: {
    id: string;
    blogKey: string;
    mode: JobMode;
    payload: unknown;
    artifactDir: string;
  }): JobRecord {
    if (!jobModes.includes(input.mode)) {
      throw new Error("Invalid job mode: " + String(input.mode));
    }
    let payloadJson: string | undefined;
    try {
      payloadJson = JSON.stringify(input.payload);
    } catch {
      throw new Error("Job payload must be JSON-serializable");
    }
    if (payloadJson === undefined) {
      throw new Error("Job payload must be JSON-serializable");
    }
    const now = nowIso();
    return this.db.transaction(() => {
      this.db
        .prepare(
          `
        INSERT INTO jobs (id, blog_key, mode, status, payload_json, artifact_dir, error, created_at, updated_at)
        VALUES (@id, @blogKey, @mode, 'PENDING', @payloadJson, @artifactDir, NULL, @now, @now)
      `
        )
        .run({
          id: input.id,
          blogKey: input.blogKey,
          mode: input.mode,
          payloadJson,
          artifactDir: input.artifactDir,
          now
        });
      this.addEvent(input.id, "JOB_CREATED", "Job created", { mode: input.mode });
      return this.find(input.id)!;
    })();
  }
  find(id: string): JobRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT id, blog_key AS blogKey, mode, status, payload_json AS payloadJson,
          artifact_dir AS artifactDir, error, created_at AS createdAt, updated_at AS updatedAt
        FROM jobs WHERE id = ?
      `
      )
      .get(id) as JobRecord | undefined;
    return row ? validatePersistedJob(row) : null;
  }

  updateStatus(id: string, status: JobStatus, message: string, metadata: unknown = {}): void {
    this.db.transaction(() => {
      const current = this.find(id);
      if (!current) throw new Error("Job not found: " + id);
      assertValidJobTransition(current.mode, current.status, status);
      const now = nowIso();
      const result = this.db
        .prepare(
          "UPDATE jobs SET status = ?, updated_at = ?, error = NULL WHERE id = ? AND status = ?"
        )
        .run(status, now, id, current.status);
      if (result.changes !== 1) {
        throw new Error(
          "Job state changed concurrently: " + id + " (expected " + current.status + ")"
        );
      }
      this.addEvent(id, status, message, metadata);
    })();
  }

  fail(id: string, error: Error): boolean {
    return this.finishWithError(id, "FAILED", error, {
      name: error.name,
      stack: error.stack
    });
  }

  stop(id: string, error: Error): boolean {
    return this.finishWithError(id, "STOPPED", error);
  }

  private finishWithError(
    id: string,
    status: "FAILED" | "STOPPED",
    error: Error,
    metadata: unknown = {}
  ): boolean {
    return this.db.transaction(() => {
      const current = this.find(id);
      if (!current) throw new Error("Job not found: " + id);
      if (current.status !== "PENDING" && current.status !== "RUNNING") return false;
      const result = this.db
        .prepare(
          "UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status = ?"
        )
        .run(status, error.message, nowIso(), id, current.status);
      if (result.changes !== 1) return false;
      this.addEvent(id, status, error.message, metadata);
      return true;
    })();
  }
  addEvent(jobId: string, eventType: string, message: string, metadata: unknown = {}): void {
    let metadataJson: string | undefined;
    try {
      metadataJson = JSON.stringify(metadata);
    } catch {
      throw new Error("Job event metadata must be JSON-serializable");
    }
    if (metadataJson === undefined) {
      throw new Error("Job event metadata must be JSON-serializable");
    }
    this.db
      .prepare(
        `
        INSERT INTO job_events (job_id, event_type, message, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
      )
      .run(jobId, eventType, message, metadataJson, nowIso());
  }
}
