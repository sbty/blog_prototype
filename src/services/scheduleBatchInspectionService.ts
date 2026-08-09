import { realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "../config/env.js";
import { scheduleBatchManifestSchema } from "../domain/scheduleBatch.js";
import { parseJsonWithBom } from "../utils/json.js";
import { readArtifactFileInsideDirectory } from "./artifacts.js";
import { canonicalUtcTimestamp } from "./scheduleArtifactValidation.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceSchema = z
  .object({
    previewSha256: sha256Schema,
    previewConfirmationSha256: sha256Schema,
    packageSha256: sha256Schema,
    auditSha256: sha256Schema
  })
  .strict();
const itemSchema = z
  .object({
    index: z.number().int().nonnegative(),
    jobId: z.string().min(1),
    status: z.enum(["SUCCEEDED", "FAILED", "SKIPPED"]),
    evidence: evidenceSchema.optional(),
    error: z.string().optional()
  })
  .strict();
const resultSchema = z
  .object({
    batchId: z.string().min(1),
    operation: z.enum(["approve-schedules", "prepare-schedules", "execute-schedules"]),
    continueOnError: z.boolean().optional(),
    artifactDir: z.string().min(1),
    reportPath: z.string().min(1),
    executionManifestPath: z.string().min(1).optional(),
    retryManifestPath: z.string().min(1).optional(),
    startedAt: canonicalUtcTimestamp,
    completedAt: canonicalUtcTimestamp,
    counts: z
      .object({
        total: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative()
      })
      .strict(),
    items: z.array(itemSchema).max(500)
  })
  .strict()
  .superRefine((result, context) => {
    const expected = {
      total: result.items.length,
      succeeded: result.items.filter((item) => item.status === "SUCCEEDED").length,
      failed: result.items.filter((item) => item.status === "FAILED").length,
      skipped: result.items.filter((item) => item.status === "SKIPPED").length
    };
    if (JSON.stringify(result.counts) !== JSON.stringify(expected)) {
      context.addIssue({
        code: "custom",
        path: ["counts"],
        message: "Schedule batch counts mismatch"
      });
    }
    result.items.forEach((item, index) => {
      if (item.index !== index) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "index"],
          message: "Schedule batch item indexes must be contiguous"
        });
      }
      if (
        result.operation === "prepare-schedules" &&
        item.status === "SUCCEEDED" &&
        !item.evidence
      ) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "evidence"],
          message: "Successful preparation requires evidence"
        });
      }
      if (result.operation !== "prepare-schedules" && item.evidence) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "evidence"],
          message: "Only preparation results may contain evidence"
        });
      }
    });
  });

export type ScheduleBatchInspectionStatus = "COMPLETED" | "RETRY_AVAILABLE" | "ATTENTION";

export interface ScheduleBatchInspectionResult {
  batchId: string;
  operation: z.infer<typeof resultSchema>["operation"];
  inspectedAt: string;
  completedAt: string;
  artifactDir: string;
  reportPath: string;
  executionManifestPath?: string;
  retryManifestPath?: string;
  status: ScheduleBatchInspectionStatus;
  reportValid: true;
  executionManifest: { present: boolean; valid: boolean; error?: string };
  retryManifest: { present: boolean; valid: boolean; error?: string };
  counts: z.infer<typeof resultSchema>["counts"];
  items: Array<z.infer<typeof itemSchema>>;
}

export class ScheduleBatchInspectionService {
  constructor(private readonly config: AppConfig) {}

  async execute(input: { batchId: string }): Promise<ScheduleBatchInspectionResult> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(input.batchId)) {
      throw new Error("Schedule batch ID is not safe");
    }
    const jobsRoot = await realpath(path.join(this.config.DATA_DIR, "jobs"));
    const batchDir = await realpath(path.join(jobsRoot, input.batchId));
    if (path.dirname(batchDir) !== jobsRoot) {
      throw new Error("Schedule batch artifact directory is outside DATA_DIR/jobs");
    }
    const report = resultSchema.parse(
      parseJsonWithBom(
        Buffer.from(
          await readArtifactFileInsideDirectory(batchDir, "schedule-batch-result.json")
        ).toString("utf8")
      )
    );
    if (report.batchId !== input.batchId) {
      throw new Error("Schedule batch report belongs to another batch");
    }
    if ((await realpath(report.artifactDir)) !== batchDir) {
      throw new Error("Schedule batch report artifact directory does not match");
    }
    this.assertReportedPath(batchDir, report.reportPath, "schedule-batch-result.json");

    const executionManifest = await this.validateExecutionManifest(batchDir, report);
    const retryManifest = await this.validateRetryManifest(batchDir, report);
    const needsRetry = report.items.some((item) => item.status !== "SUCCEEDED");
    const status: ScheduleBatchInspectionStatus =
      !executionManifest.valid || !retryManifest.valid
        ? "ATTENTION"
        : needsRetry
          ? "RETRY_AVAILABLE"
          : "COMPLETED";
    return {
      batchId: input.batchId,
      operation: report.operation,
      inspectedAt: new Date().toISOString(),
      completedAt: report.completedAt,
      artifactDir: batchDir,
      reportPath: report.reportPath,
      ...(report.executionManifestPath
        ? { executionManifestPath: report.executionManifestPath }
        : {}),
      ...(report.retryManifestPath ? { retryManifestPath: report.retryManifestPath } : {}),
      status,
      reportValid: true,
      executionManifest,
      retryManifest,
      counts: report.counts,
      items: report.items
    };
  }

  private async validateExecutionManifest(
    batchDir: string,
    report: z.infer<typeof resultSchema>
  ): Promise<{ present: boolean; valid: boolean; error?: string }> {
    const expected = report.items.flatMap((item) =>
      report.operation === "prepare-schedules" && item.status === "SUCCEEDED" && item.evidence
        ? [
            {
              jobId: item.jobId,
              confirmation: item.jobId,
              packageSha256: item.evidence.packageSha256,
              auditSha256: item.evidence.auditSha256
            }
          ]
        : []
    );
    if (!report.executionManifestPath) {
      return expected.length > 0
        ? { present: false, valid: false, error: "Execution manifest is missing" }
        : { present: false, valid: true };
    }
    try {
      this.assertReportedPath(
        batchDir,
        report.executionManifestPath,
        "schedule-execution-batch.json"
      );
      const manifest = scheduleBatchManifestSchema.parse(
        parseJsonWithBom(
          Buffer.from(
            await readArtifactFileInsideDirectory(batchDir, "schedule-execution-batch.json")
          ).toString("utf8")
        )
      );
      if (manifest.operation !== "execute-schedules") {
        throw new Error("Execution manifest has the wrong operation");
      }
      if (
        report.continueOnError !== undefined &&
        manifest.continueOnError !== report.continueOnError
      ) {
        throw new Error("Execution manifest continueOnError does not match the batch report");
      }
      if (JSON.stringify(manifest.items) !== JSON.stringify(expected)) {
        throw new Error("Execution manifest does not match successful preparation items");
      }
      return { present: true, valid: true };
    } catch (error) {
      return { present: true, valid: false, error: this.errorMessage(error) };
    }
  }

  private async validateRetryManifest(
    batchDir: string,
    report: z.infer<typeof resultSchema>
  ): Promise<{ present: boolean; valid: boolean; error?: string }> {
    const expectedJobIds = report.items
      .filter((item) => item.status !== "SUCCEEDED")
      .map((item) => item.jobId);
    if (!report.retryManifestPath) {
      return expectedJobIds.length > 0
        ? { present: false, valid: false, error: "Retry manifest is missing" }
        : { present: false, valid: true };
    }
    try {
      this.assertReportedPath(batchDir, report.retryManifestPath, "schedule-batch-retry.json");
      const manifest = scheduleBatchManifestSchema.parse(
        parseJsonWithBom(
          Buffer.from(
            await readArtifactFileInsideDirectory(batchDir, "schedule-batch-retry.json")
          ).toString("utf8")
        )
      );
      if (manifest.operation !== report.operation) {
        throw new Error("Retry manifest has the wrong operation");
      }
      if (
        JSON.stringify(manifest.items.map((item) => item.jobId)) !== JSON.stringify(expectedJobIds)
      ) {
        throw new Error("Retry manifest does not match failed and skipped items");
      }
      return { present: true, valid: true };
    } catch (error) {
      return { present: true, valid: false, error: this.errorMessage(error) };
    }
  }

  private assertReportedPath(batchDir: string, reportedPath: string, fileName: string): void {
    if (path.resolve(reportedPath) !== path.join(batchDir, fileName)) {
      throw new Error(`Schedule batch reported path does not match ${fileName}`);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
