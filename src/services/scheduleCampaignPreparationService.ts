import path from "node:path";
import type { Logger } from "pino";
import type { BlogConfig } from "../config/blogConfig.js";
import type { AppConfig } from "../config/env.js";
import { scheduleCampaignManifestSchema } from "../domain/scheduleCampaign.js";
import type { ArticleInput } from "../domain/article.js";
import { assertNotStopped, StopRequestedError } from "../system/stop.js";
import { createArtifactDir, makeJobId, writeJsonArtifactAtomic } from "./artifacts.js";
import type { SchedulePreparationEvidence } from "./scheduleEvidencePreparationService.js";
import type { ScheduleCampaignPreflightResult } from "./scheduleCampaignPreflightService.js";

interface PlannedJob {
  jobId: string;
  artifactDir: string;
}

export interface ScheduleCampaignItemResult {
  index: number;
  blogKey: string;
  slug: string;
  title: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  jobId?: string;
  evidence?: SchedulePreparationEvidence;
  failedPhase?: "PLAN" | "APPROVAL" | "PREPARATION" | "RECOVERY";
  error?: string;
}

export interface ScheduleCampaignPreparationResult {
  campaignId: string;
  operation: "prepare-campaign";
  artifactDir: string;
  reportPath: string;
  preflightPath: string;
  executionManifestPath?: string;
  retryManifestPath?: string;
  startedAt: string;
  completedAt: string;
  counts: { total: number; succeeded: number; failed: number; skipped: number };
  items: ScheduleCampaignItemResult[];
}

export class ScheduleCampaignPreparationService {
  constructor(
    private readonly config: AppConfig,
    private readonly stages: {
      preflight: (input: unknown) => Promise<ScheduleCampaignPreflightResult>;
      plan: (input: { blog: BlogConfig; article: ArticleInput }) => Promise<PlannedJob>;
      approve: (input: { jobId: string; confirmation: string }) => Promise<unknown>;
      prepare: (input: {
        jobId: string;
        confirmation: string;
      }) => Promise<SchedulePreparationEvidence>;
      recover: (input: {
        jobId: string;
        blog: BlogConfig;
        article: ArticleInput;
      }) => Promise<SchedulePreparationEvidence>;
    },
    private readonly logger: Logger
  ) {}

  async execute(input: unknown): Promise<ScheduleCampaignPreparationResult> {
    const manifest = scheduleCampaignManifestSchema.parse(input);
    const preflight = await this.stages.preflight(manifest);
    if (!preflight.passed) {
      const summary = preflight.issues
        .slice(0, 10)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ");
      throw new Error(`Campaign preflight failed: ${summary}`);
    }
    this.assertEnabled();
    await assertNotStopped(this.config.DATA_DIR);

    const campaignId = makeJobId("schedule-campaign");
    const artifactDir = await createArtifactDir(this.config.DATA_DIR, campaignId);
    const reportPath = path.join(artifactDir, "schedule-campaign-result.json");
    const preflightPath = path.join(artifactDir, "schedule-campaign-preflight.json");
    await writeJsonArtifactAtomic(preflightPath, preflight);
    const startedAt = new Date().toISOString();
    const blogs = new Map(manifest.blogs.map((blog) => [blog.blogKey, blog]));
    const results: ScheduleCampaignItemResult[] = [];

    for (let index = 0; index < manifest.items.length; index += 1) {
      const item = manifest.items[index];
      let jobId: string | undefined;
      let phase: ScheduleCampaignItemResult["failedPhase"] = "PLAN";
      try {
        await assertNotStopped(this.config.DATA_DIR);
        let evidence: SchedulePreparationEvidence;
        if (item.resumeJobId) {
          jobId = item.resumeJobId;
          phase = "RECOVERY";
          evidence = await this.stages.recover({
            jobId,
            blog: blogs.get(item.blogKey)!,
            article: item.article
          });
        } else {
          const planned = await this.stages.plan({
            blog: blogs.get(item.blogKey)!,
            article: item.article
          });
          jobId = planned.jobId;
          phase = "APPROVAL";
          await this.stages.approve({ jobId, confirmation: jobId });
          phase = "PREPARATION";
          evidence = await this.stages.prepare({ jobId, confirmation: jobId });
        }
        results.push({
          index,
          blogKey: item.blogKey,
          slug: item.article.slug,
          title: item.article.title,
          status: "SUCCEEDED",
          jobId,
          evidence
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          index,
          blogKey: item.blogKey,
          slug: item.article.slug,
          title: item.article.title,
          status: "FAILED",
          ...(jobId ? { jobId } : {}),
          failedPhase: phase,
          error: message
        });
        if (error instanceof StopRequestedError || !manifest.continueOnError) {
          const reason =
            error instanceof StopRequestedError
              ? "Skipped because STOP was requested"
              : "Skipped after an earlier item failed";
          for (let skipped = index + 1; skipped < manifest.items.length; skipped += 1) {
            const skippedItem = manifest.items[skipped];
            results.push({
              index: skipped,
              blogKey: skippedItem.blogKey,
              slug: skippedItem.article.slug,
              title: skippedItem.article.title,
              status: "SKIPPED",
              error: reason
            });
          }
          break;
        }
      }
    }

    const successful = results.filter(
      (
        item
      ): item is ScheduleCampaignItemResult & {
        jobId: string;
        evidence: SchedulePreparationEvidence;
      } => item.status === "SUCCEEDED" && Boolean(item.jobId && item.evidence)
    );
    let executionManifestPath: string | undefined;
    if (successful.length > 0) {
      executionManifestPath = path.join(artifactDir, "schedule-execution-batch.json");
      await writeJsonArtifactAtomic(executionManifestPath, {
        operation: "execute-schedules",
        continueOnError: manifest.continueOnError,
        items: successful.map((item) => ({
          jobId: item.jobId,
          confirmation: item.jobId,
          packageSha256: item.evidence.packageSha256,
          auditSha256: item.evidence.auditSha256
        }))
      });
    }

    const retryItems = results.flatMap((resultItem) => {
      if (resultItem.status === "SUCCEEDED") return [];
      const original = manifest.items[resultItem.index];
      return [
        {
          ...original,
          ...(resultItem.jobId ? { resumeJobId: resultItem.jobId } : {})
        }
      ];
    });
    let retryManifestPath: string | undefined;
    if (retryItems.length > 0) {
      retryManifestPath = path.join(artifactDir, "schedule-campaign-retry.json");
      await writeJsonArtifactAtomic(retryManifestPath, {
        operation: "prepare-campaign",
        continueOnError: manifest.continueOnError,
        blogs: manifest.blogs,
        items: retryItems
      });
    }
    const result: ScheduleCampaignPreparationResult = {
      campaignId,
      operation: manifest.operation,
      artifactDir,
      reportPath,
      preflightPath,
      ...(executionManifestPath ? { executionManifestPath } : {}),
      ...(retryManifestPath ? { retryManifestPath } : {}),
      startedAt,
      completedAt: new Date().toISOString(),
      counts: {
        total: results.length,
        succeeded: successful.length,
        failed: results.filter((item) => item.status === "FAILED").length,
        skipped: results.filter((item) => item.status === "SKIPPED").length
      },
      items: results
    };
    await writeJsonArtifactAtomic(reportPath, result);
    this.logger.info(
      { campaignId, counts: result.counts, reportPath, executionManifestPath, retryManifestPath },
      "Schedule campaign preparation completed"
    );
    return result;
  }

  private assertEnabled(): void {
    if (!this.config.ENABLE_DRY_RUN) {
      throw new Error("Schedule campaign preparation requires ENABLE_DRY_RUN=true");
    }
    if (this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Schedule campaign preparation requires ENABLE_DRAFT_SAVE=false and ENABLE_SCHEDULED_POST=false"
      );
    }
  }
}
