import { realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "../config/env.js";
import type { JobStatus } from "../domain/job.js";
import { scheduleCampaignManifestSchema } from "../domain/scheduleCampaign.js";
import type { JobRepository } from "../repositories/jobRepository.js";
import { parseJsonWithBom } from "../utils/json.js";
import { readArtifactFileInsideDirectory } from "./artifacts.js";
import { calculateArtifactSha256 } from "./scheduleApprovalIntegrity.js";
import { canonicalUtcTimestamp } from "./scheduleArtifactValidation.js";
import { scheduleBatchManifestSchema } from "../domain/scheduleBatch.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceSchema = z
  .object({
    previewSha256: sha256Schema,
    previewConfirmationSha256: sha256Schema,
    packageSha256: sha256Schema,
    auditSha256: sha256Schema
  })
  .strict();
const campaignItemSchema = z
  .object({
    index: z.number().int().nonnegative(),
    blogKey: z.string().min(1),
    slug: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(["SUCCEEDED", "FAILED", "SKIPPED"]),
    jobId: z.string().min(1).optional(),
    evidence: evidenceSchema.optional(),
    failedPhase: z.enum(["PLAN", "APPROVAL", "PREPARATION", "RECOVERY"]).optional(),
    error: z.string().optional()
  })
  .strict()
  .superRefine((item, context) => {
    if (item.status === "SUCCEEDED" && (!item.jobId || !item.evidence)) {
      context.addIssue({ code: "custom", message: "Successful item requires job evidence" });
    }
  });
const campaignResultSchema = z
  .object({
    campaignId: z.string().min(1),
    operation: z.literal("prepare-campaign"),
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
    items: z.array(campaignItemSchema).max(500)
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
      context.addIssue({ code: "custom", path: ["counts"], message: "Campaign counts mismatch" });
    }
  });

type CampaignItem = z.infer<typeof campaignItemSchema>;
export type CampaignItemAction =
  | "READY_TO_EXECUTE"
  | "RETRY_AVAILABLE"
  | "EXECUTED"
  | "EVIDENCE_INVALID"
  | "JOB_MISSING"
  | "JOB_STATE_INVALID"
  | "NEEDS_ATTENTION";

export interface CampaignInspectionItem {
  index: number;
  blogKey: string;
  slug: string;
  title: string;
  recordedStatus: CampaignItem["status"];
  jobId?: string;
  currentJobStatus?: JobStatus;
  action: CampaignItemAction;
  detail?: string;
}

export interface ScheduleCampaignInspectionResult {
  campaignId: string;
  inspectedAt: string;
  completedAt: string;
  reportValid: true;
  executionManifest: { present: boolean; valid: boolean; error?: string };
  retryManifest: { present: boolean; valid: boolean; error?: string };
  counts: Record<CampaignItemAction, number>;
  items: CampaignInspectionItem[];
}

export class ScheduleCampaignInspectionService {
  constructor(
    private readonly config: AppConfig,
    private readonly jobs: Pick<JobRepository, "find">
  ) {}

  async execute(input: { campaignId: string }): Promise<ScheduleCampaignInspectionResult> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(input.campaignId)) {
      throw new Error("Campaign ID is not safe");
    }
    const jobsRoot = await realpath(path.join(this.config.DATA_DIR, "jobs"));
    const campaignDir = await realpath(path.join(jobsRoot, input.campaignId));
    if (path.dirname(campaignDir) !== jobsRoot) {
      throw new Error("Campaign artifact directory is outside DATA_DIR/jobs");
    }
    const reportBytes = await readArtifactFileInsideDirectory(
      campaignDir,
      "schedule-campaign-result.json"
    );
    const report = campaignResultSchema.parse(
      parseJsonWithBom(Buffer.from(reportBytes).toString("utf8"))
    );
    if (report.campaignId !== input.campaignId) {
      throw new Error("Campaign report belongs to another campaign");
    }
    if ((await realpath(report.artifactDir)) !== campaignDir) {
      throw new Error("Campaign report artifact directory does not match");
    }
    this.assertReportedPath(campaignDir, report.reportPath, "schedule-campaign-result.json");

    const executionManifest = await this.validateExecutionManifest(campaignDir, report);
    const retryManifest = await this.validateRetryManifest(campaignDir, report);
    const items: CampaignInspectionItem[] = [];
    for (const item of report.items) {
      items.push(await this.inspectItem(item, retryManifest.valid, jobsRoot));
    }
    const actions: CampaignItemAction[] = [
      "READY_TO_EXECUTE",
      "RETRY_AVAILABLE",
      "EXECUTED",
      "EVIDENCE_INVALID",
      "JOB_MISSING",
      "JOB_STATE_INVALID",
      "NEEDS_ATTENTION"
    ];
    return {
      campaignId: input.campaignId,
      inspectedAt: new Date().toISOString(),
      completedAt: report.completedAt,
      reportValid: true,
      executionManifest,
      retryManifest,
      counts: Object.fromEntries(
        actions.map((action) => [action, items.filter((item) => item.action === action).length])
      ) as Record<CampaignItemAction, number>,
      items
    };
  }

  private async inspectItem(
    item: CampaignItem,
    retryManifestValid: boolean,
    jobsRoot: string
  ): Promise<CampaignInspectionItem> {
    const base = {
      index: item.index,
      blogKey: item.blogKey,
      slug: item.slug,
      title: item.title,
      recordedStatus: item.status,
      ...(item.jobId ? { jobId: item.jobId } : {})
    };
    if (!item.jobId) {
      return {
        ...base,
        action: retryManifestValid ? "RETRY_AVAILABLE" : "NEEDS_ATTENTION",
        detail: item.error
      };
    }
    const job = this.jobs.find(item.jobId);
    if (!job) return { ...base, action: "JOB_MISSING" };
    const withStatus = { ...base, currentJobStatus: job.status };
    if (job.blogKey !== item.blogKey || job.mode !== "schedule") {
      return { ...withStatus, action: "JOB_STATE_INVALID", detail: "Job identity mismatch" };
    }
    let jobArtifactDir: string;
    try {
      jobArtifactDir = await realpath(job.artifactDir);
      if (path.dirname(jobArtifactDir) !== jobsRoot) {
        throw new Error("Job artifact directory is outside DATA_DIR/jobs");
      }
    } catch (error) {
      return {
        ...withStatus,
        action: "JOB_STATE_INVALID",
        detail: error instanceof Error ? error.message : String(error)
      };
    }
    const executionResult = await this.readOptionalArtifact(
      jobArtifactDir,
      "schedule-execution-result.json"
    );
    if (executionResult) {
      try {
        z.object({
          currentUrl: z.string().url(),
          savedAt: canonicalUtcTimestamp,
          scheduledAt: canonicalUtcTimestamp
        })
          .passthrough()
          .parse(parseJsonWithBom(Buffer.from(executionResult).toString("utf8")));
        return { ...withStatus, action: "EXECUTED" };
      } catch {
        return {
          ...withStatus,
          action: "EVIDENCE_INVALID",
          detail: "Execution result artifact is invalid"
        };
      }
    }
    if (item.status !== "SUCCEEDED" || !item.evidence) {
      return {
        ...withStatus,
        action: retryManifestValid ? "RETRY_AVAILABLE" : "NEEDS_ATTENTION",
        detail: item.error
      };
    }
    if (job.status !== "PREVIEW_CONFIRMED") {
      return {
        ...withStatus,
        action: "JOB_STATE_INVALID",
        detail: "Prepared job is not PREVIEW_CONFIRMED"
      };
    }
    try {
      const [packageBytes, auditBytes] = await Promise.all([
        readArtifactFileInsideDirectory(jobArtifactDir, "schedule-execution-package.json"),
        readArtifactFileInsideDirectory(jobArtifactDir, "schedule-execution-package-audit.json")
      ]);
      if (
        calculateArtifactSha256(packageBytes) !== item.evidence.packageSha256 ||
        calculateArtifactSha256(auditBytes) !== item.evidence.auditSha256
      ) {
        throw new Error("Prepared evidence SHA-256 mismatch");
      }
      return { ...withStatus, action: "READY_TO_EXECUTE" };
    } catch (error) {
      return {
        ...withStatus,
        action: "EVIDENCE_INVALID",
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async validateExecutionManifest(
    campaignDir: string,
    report: z.infer<typeof campaignResultSchema>
  ): Promise<{ present: boolean; valid: boolean; error?: string }> {
    if (!report.executionManifestPath) {
      const hasSuccess = report.items.some((item) => item.status === "SUCCEEDED");
      return hasSuccess
        ? { present: false, valid: false, error: "Execution manifest is missing" }
        : { present: false, valid: true };
    }
    try {
      this.assertReportedPath(
        campaignDir,
        report.executionManifestPath,
        "schedule-execution-batch.json"
      );
      const bytes = await readArtifactFileInsideDirectory(
        campaignDir,
        "schedule-execution-batch.json"
      );
      const manifest = scheduleBatchManifestSchema.parse(
        parseJsonWithBom(Buffer.from(bytes).toString("utf8"))
      );
      if (manifest.operation !== "execute-schedules") {
        throw new Error("Execution manifest has the wrong operation");
      }
      const expected = report.items.flatMap((item) =>
        item.status === "SUCCEEDED" && item.jobId && item.evidence
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
      if (JSON.stringify(manifest.items) !== JSON.stringify(expected)) {
        throw new Error("Execution manifest does not match successful campaign items");
      }
      return { present: true, valid: true };
    } catch (error) {
      return {
        present: true,
        valid: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async validateRetryManifest(
    campaignDir: string,
    report: z.infer<typeof campaignResultSchema>
  ): Promise<{ present: boolean; valid: boolean; error?: string }> {
    if (!report.retryManifestPath) {
      const hasRetryable = report.items.some((item) => item.status !== "SUCCEEDED");
      return hasRetryable
        ? { present: false, valid: false, error: "Retry manifest is missing" }
        : { present: false, valid: true };
    }
    try {
      this.assertReportedPath(
        campaignDir,
        report.retryManifestPath,
        "schedule-campaign-retry.json"
      );
      const bytes = await readArtifactFileInsideDirectory(
        campaignDir,
        "schedule-campaign-retry.json"
      );
      const manifest = scheduleCampaignManifestSchema.parse(
        parseJsonWithBom(Buffer.from(bytes).toString("utf8"))
      );
      const expectedCount = report.items.filter((item) => item.status !== "SUCCEEDED").length;
      if (manifest.items.length !== expectedCount) {
        throw new Error("Retry manifest item count does not match campaign failures");
      }
      return { present: true, valid: true };
    } catch (error) {
      return {
        present: true,
        valid: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private assertReportedPath(campaignDir: string, reportedPath: string, fileName: string): void {
    if (path.resolve(reportedPath) !== path.join(campaignDir, fileName)) {
      throw new Error(`Campaign reported path does not match ${fileName}`);
    }
  }

  private async readOptionalArtifact(
    artifactDir: string,
    fileName: string
  ): Promise<Buffer | null> {
    try {
      return await readArtifactFileInsideDirectory(artifactDir, fileName);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
