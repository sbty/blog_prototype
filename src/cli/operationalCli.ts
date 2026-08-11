import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openChromeForManualLogin } from "../browser/chromeProfile.js";
import { BloggerDryRunClient } from "../browser/bloggerDryRun.js";
import { loadBloggerSelectors } from "../browser/bloggerSelectors.js";
import { blogConfigSchema } from "../config/blogConfig.js";
import { loadConfig } from "../config/env.js";
import { articleInputSchema } from "../domain/article.js";
import { createLogger } from "../logging/logger.js";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { withMigratedDatabase } from "../repositories/database.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { DryRunService } from "../services/dryRunService.js";
import { DraftSaveService } from "../services/draftSaveService.js";
import { BatchExecutionService } from "../services/batchExecutionService.js";
import { ScheduleBatchExecutionService } from "../services/scheduleBatchExecutionService.js";
import { ScheduleBatchInspectionService } from "../services/scheduleBatchInspectionService.js";
import { ScheduleBatchListService } from "../services/scheduleBatchListService.js";
import { ScheduleEvidencePreparationService } from "../services/scheduleEvidencePreparationService.js";
import { ScheduleCampaignPreparationService } from "../services/scheduleCampaignPreparationService.js";
import { ScheduleCampaignItemRecoveryService } from "../services/scheduleCampaignItemRecoveryService.js";
import { ScheduleCampaignInspectionService } from "../services/scheduleCampaignInspectionService.js";
import { ScheduleCampaignListService } from "../services/scheduleCampaignListService.js";
import { ScheduleCampaignPreflightService } from "../services/scheduleCampaignPreflightService.js";
import { SchedulePlanService } from "../services/schedulePlanService.js";
import { ScheduleApprovalService } from "../services/scheduleApprovalService.js";
import { ScheduleReadinessService } from "../services/scheduleReadinessService.js";
import { ScheduleCancellationService } from "../services/scheduleCancellationService.js";
import { ApprovedSchedulePreviewService } from "../services/approvedSchedulePreviewService.js";
import { SchedulePreviewConfirmationService } from "../services/schedulePreviewConfirmationService.js";
import { ScheduleExecutionPackageService } from "../services/scheduleExecutionPackageService.js";
import { ScheduleExecutionPackageAuditService } from "../services/scheduleExecutionPackageAuditService.js";
import { PublishedPostAuditService } from "../services/publishedPostAuditService.js";
import { ScheduledPostExecutionService } from "../services/scheduledPostExecutionService.js";
import { parseJsonWithBom } from "../utils/json.js";

import { commandRequiresDatabase, parseArgs } from "./args.js";

function requiredString(options: Record<string, string>, key: string): string {
  const value = options[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required option --${key}`);
  }
  return value;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return parseJsonWithBom<T>(await readFile(resolve(filePath), "utf8"));
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    printHelp();
    return;
  }

  const config = loadConfig();
  const logger = createLogger(config);
  if (args.command === "open-login") {
    const blog = blogConfigSchema.parse(await readJsonFile(requiredString(args.options, "blog")));
    const result = await openChromeForManualLogin({ config, url: blog.adminUrl });
    logger.info(
      { profilePath: result.profilePath, adminUrl: blog.adminUrl },
      "Chrome opened for manual Blogger login. Close that Chrome window before running dry-run."
    );
    return;
  }

  if (args.command === "audit-drafts") {
    const blog = blogConfigSchema.parse(await readJsonFile(requiredString(args.options, "blog")));
    const article = articleInputSchema.parse(
      await readJsonFile(requiredString(args.options, "article"))
    );
    const selectors = await loadBloggerSelectors(blog.blogger.selectorsPath);
    const result = await new BloggerDryRunClient(config, selectors).findDrafts({
      adminUrl: blog.adminUrl,
      title: article.title
    });
    logger.info(result, "Draft audit result");
    return;
  }

  if (args.command === "audit-published-post") {
    const blog = blogConfigSchema.parse(await readJsonFile(requiredString(args.options, "blog")));
    const article = articleInputSchema.parse(
      await readJsonFile(requiredString(args.options, "article"))
    );
    const result = await new PublishedPostAuditService().execute({ blog, article });
    logger.info(result, "Published post audit result");
    return;
  }
  if (args.command === "list-schedule-batches") {
    const inspector = new ScheduleBatchInspectionService(config);
    const result = await new ScheduleBatchListService(config, inspector).execute();
    logger.info(result, "Schedule batch list result");
    return;
  }
  if (args.command === "inspect-schedule-batch") {
    const batchId = requiredString(args.options, "batch");
    const result = await new ScheduleBatchInspectionService(config).execute({ batchId });
    logger.info(result, "Schedule batch inspection result");
    return;
  }
  if (!commandRequiresDatabase(args.command)) {
    throw new Error(`Command does not have a database policy: ${args.command}`);
  }

  await withMigratedDatabase(config.DATABASE_PATH, async (db) => {
    const repos = {
      blogs: new BlogRepository(db),
      jobs: new JobRepository(db),
      articles: new ArticleRepository(db)
    };

    if (args.command === "init-db") {
      logger.info({ databasePath: config.DATABASE_PATH }, "Database initialized");
      return;
    }

    if (args.command === "register-blog") {
      const blog = blogConfigSchema.parse(await readJsonFile(requiredString(args.options, "blog")));
      repos.blogs.upsert(blog);
      logger.info({ blogKey: blog.blogKey }, "Blog registered");
      return;
    }
    if (args.command === "dry-run") {
      const blog = blogConfigSchema.parse(await readJsonFile(requiredString(args.options, "blog")));
      const article = articleInputSchema.parse(
        await readJsonFile(requiredString(args.options, "article"))
      );
      const result = await new DryRunService(config, repos, logger).execute({
        blog,
        article
      });
      logger.info(result, "Dry-run result");
      return;
    }

    if (args.command === "run-batch") {
      const manifest = await readJsonFile<unknown>(requiredString(args.options, "manifest"));
      const dryRunService = new DryRunService(config, repos, logger);
      const draftService = new DraftSaveService(config, repos, logger);
      const scheduleService = new SchedulePlanService(config, repos, logger);
      const result = await new BatchExecutionService(
        config,
        {
          dryRun: (input) => dryRunService.execute(input),
          saveDraft: (input) => draftService.execute(input),
          planSchedule: async (input) => {
            const planned = await scheduleService.execute(input);
            return { jobId: planned.jobId, artifactDir: planned.artifactDir };
          }
        },
        logger
      ).execute(manifest);
      logger.info(result, "Batch result");
      return;
    }
    if (args.command === "list-campaigns") {
      const inspector = new ScheduleCampaignInspectionService(config, repos.jobs);
      const result = await new ScheduleCampaignListService(config, inspector).execute();
      logger.info(result, "Schedule campaign list result");
      return;
    }
    if (args.command === "inspect-campaign") {
      const campaignId = requiredString(args.options, "campaign");
      const result = await new ScheduleCampaignInspectionService(config, repos.jobs).execute({
        campaignId
      });
      logger.info(result, "Schedule campaign inspection result");
      return;
    }
    if (args.command === "validate-campaign") {
      const manifest = await readJsonFile<unknown>(requiredString(args.options, "manifest"));
      const result = await new ScheduleCampaignPreflightService(config, repos.articles).execute(
        manifest
      );
      logger.info(result, "Schedule campaign preflight result");
      if (!result.passed) throw new Error("Campaign preflight failed");
      return;
    }
    if (args.command === "prepare-campaign") {
      const manifest = await readJsonFile<unknown>(requiredString(args.options, "manifest"));
      const preflightService = new ScheduleCampaignPreflightService(config, repos.articles);
      const planService = new SchedulePlanService(config, repos, logger);
      const approvalService = new ScheduleApprovalService(
        config,
        repos.jobs,
        repos.articles,
        logger
      );
      const preparationService = new ScheduleEvidencePreparationService(config, repos.jobs, {
        preview: new ApprovedSchedulePreviewService(config, repos, logger),
        confirm: new SchedulePreviewConfirmationService(config, repos.jobs, logger),
        preparePackage: new ScheduleExecutionPackageService(config, repos.jobs, logger),
        auditPackage: new ScheduleExecutionPackageAuditService(config, repos.jobs, logger)
      });
      const recoveryService = new ScheduleCampaignItemRecoveryService(repos, {
        approve: (input) => approvalService.execute(input),
        prepare: (input) => preparationService.execute(input)
      });
      const result = await new ScheduleCampaignPreparationService(
        config,
        {
          preflight: (input) => preflightService.execute(input),
          plan: (input) => planService.execute(input),
          approve: (input) => approvalService.execute(input),
          prepare: (input) => preparationService.execute(input),
          recover: (input) => recoveryService.execute(input)
        },
        logger
      ).execute(manifest);
      logger.info(result, "Schedule campaign preparation result");
      return;
    }
    if (args.command === "run-schedule-batch") {
      const manifest = await readJsonFile<unknown>(requiredString(args.options, "manifest"));
      const approvalService = new ScheduleApprovalService(
        config,
        repos.jobs,
        repos.articles,
        logger
      );
      const previewService = new ApprovedSchedulePreviewService(config, repos, logger);
      const confirmationService = new SchedulePreviewConfirmationService(
        config,
        repos.jobs,
        logger
      );
      const packageService = new ScheduleExecutionPackageService(config, repos.jobs, logger);
      const auditService = new ScheduleExecutionPackageAuditService(config, repos.jobs, logger);
      const preparationService = new ScheduleEvidencePreparationService(config, repos.jobs, {
        preview: previewService,
        confirm: confirmationService,
        preparePackage: packageService,
        auditPackage: auditService
      });
      const executionService = new ScheduledPostExecutionService(config, repos, logger);
      const result = await new ScheduleBatchExecutionService(
        config,
        {
          approve: (input) => approvalService.execute(input),
          prepare: (input) => preparationService.execute(input),
          validateExecution: (input) => executionService.validate(input),
          execute: (input) => executionService.execute(input)
        },
        logger
      ).run(manifest);
      logger.info(result, "Schedule batch result");
      return;
    }
    if (args.command === "execute-schedule") {
      const result = await new ScheduledPostExecutionService(config, repos, logger).execute({
        jobId: requiredString(args.options, "job"),
        confirmation: requiredString(args.options, "confirm"),
        packageSha256: requiredString(args.options, "package-sha"),
        auditSha256: requiredString(args.options, "audit-sha")
      });
      logger.info(result, "Scheduled post execution result");
      return;
    }
    if (args.command === "audit-execution-package") {
      const jobId = requiredString(args.options, "job");
      const packageSha256 = requiredString(args.options, "package-sha");
      const result = await new ScheduleExecutionPackageAuditService(
        config,
        repos.jobs,
        logger
      ).execute({ jobId, packageSha256 });
      logger.info(result, "Schedule execution package audit result");
      return;
    }
    if (args.command === "prepare-execution-package") {
      const jobId = requiredString(args.options, "job");
      const confirmation = requiredString(args.options, "confirm");
      const previewConfirmationSha256 = requiredString(args.options, "preview-confirmation-sha");
      const result = await new ScheduleExecutionPackageService(config, repos.jobs, logger).execute({
        jobId,
        confirmation,
        previewConfirmationSha256
      });
      logger.info(result, "Schedule execution package result");
      return;
    }
    if (args.command === "confirm-schedule-preview") {
      const jobId = requiredString(args.options, "job");
      const confirmation = requiredString(args.options, "confirm");
      const previewSha256 = requiredString(args.options, "preview-sha");
      const result = await new SchedulePreviewConfirmationService(
        config,
        repos.jobs,
        logger
      ).execute({ jobId, confirmation, previewSha256 });
      logger.info(result, "Schedule preview confirmation result");
      return;
    }
    if (args.command === "preview-approved-schedule") {
      const jobId = requiredString(args.options, "job");
      const result = await new ApprovedSchedulePreviewService(config, repos, logger).execute({
        jobId
      });
      logger.info(result, "Approved schedule browser preview result");
      return;
    }
    if (args.command === "cancel-schedule") {
      const jobId = requiredString(args.options, "job");
      const confirmation = requiredString(args.options, "confirm");
      const result = await new ScheduleCancellationService(config, repos.jobs, logger).execute({
        jobId,
        confirmation
      });
      logger.info(result, "Local schedule cancellation result");
      return;
    }
    if (args.command === "check-schedule") {
      const jobId = requiredString(args.options, "job");
      const result = await new ScheduleReadinessService(config, repos, logger).execute({ jobId });
      logger.info(result, "Local schedule readiness result");
      return;
    }
    if (args.command === "approve-schedule") {
      const jobId = requiredString(args.options, "job");
      const confirmation = requiredString(args.options, "confirm");
      const result = await new ScheduleApprovalService(
        config,
        repos.jobs,
        repos.articles,
        logger
      ).execute({
        jobId,
        confirmation
      });
      logger.info(result, "Local schedule approval result");
      return;
    }
    if (args.command === "plan-schedule") {
      const blog = blogConfigSchema.parse(await readJsonFile(requiredString(args.options, "blog")));
      const article = articleInputSchema.parse(
        await readJsonFile(requiredString(args.options, "article"))
      );
      const result = await new SchedulePlanService(config, repos, logger).execute({
        blog,
        article
      });
      logger.info(result, "Local schedule plan result");
      return;
    }
    if (args.command === "save-draft") {
      const blog = blogConfigSchema.parse(await readJsonFile(requiredString(args.options, "blog")));
      const article = articleInputSchema.parse(
        await readJsonFile(requiredString(args.options, "article"))
      );
      const result = await new DraftSaveService(config, repos, logger).execute({
        blog,
        article
      });
      logger.info(result, "Draft save result");
      return;
    }
    throw new Error(`Unknown command: ${args.command}`);
  });
}

function printHelp(): void {
  console.log(`AI Blogger Content Automation

Commands:
  init-db
  open-login --blog <path>
  register-blog --blog <path>
  audit-drafts --blog <path> --article <path>
  audit-published-post --blog <path> --article <path>
  dry-run --blog <path> --article <path>
  save-draft --blog <path> --article <path>
  run-batch --manifest <path>
  run-schedule-batch --manifest <path>
  inspect-schedule-batch --batch <batchId>
  list-schedule-batches
  prepare-campaign --manifest <path>
  validate-campaign --manifest <path>
  inspect-campaign --campaign <campaignId>
  list-campaigns
  plan-schedule --blog <path> --article <path>
  approve-schedule --job <jobId> --confirm <jobId>
  check-schedule --job <jobId>
  cancel-schedule --job <jobId> --confirm <jobId>
  preview-approved-schedule --job <jobId>
  confirm-schedule-preview --job <jobId> --confirm <jobId> --preview-sha <sha256>
  prepare-execution-package --job <jobId> --confirm <jobId> --preview-confirmation-sha <sha256>
  audit-execution-package --job <jobId> --package-sha <sha256>
  execute-schedule --job <jobId> --confirm <jobId> --package-sha <sha256> --audit-sha <sha256>

Dry-run opens Blogger and fills the editor only. It never saves, publishes, or confirms scheduling.
Save-draft requires ENABLE_DRAFT_SAVE=true and never clicks Publish or confirms scheduling.
Run-batch executes multiple draft saves or creates multiple local schedule plans from one manifest.
Run-schedule-batch approves, prepares evidence for, or executes multiple scheduled jobs from one manifest.
Inspect-schedule-batch validates a batch report and companion manifests without writing state.
List-schedule-batches summarizes all schedule batch states without writing state.
Prepare-campaign plans, approves, previews, and packages multiple scheduled articles without publishing.
Validate-campaign checks the entire campaign without creating jobs or opening Blogger.
Inspect-campaign validates campaign artifacts and reports each article action without writing state.
List-campaigns summarizes all campaign states without writing state.
Plan-schedule, approve-schedule, check-schedule, cancel-schedule, and prepare-execution-package are local-only and never open Blogger.
Use open-login first when Google blocks login in an automated browser.
`);
}
