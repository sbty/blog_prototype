import { open, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { openChromeForManualLogin } from "../browser/chromeProfile.js";
import { BloggerDryRunClient } from "../browser/bloggerDryRun.js";
import { loadBloggerSelectors } from "../browser/bloggerSelectors.js";
import { blogConfigSchema } from "../config/blogConfig.js";
import { loadConfig } from "../config/env.js";
import { articleInputSchema } from "../domain/article.js";
import { batchManifestSchema } from "../domain/batch.js";
import { createLogger } from "../logging/logger.js";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { withMigratedDatabase } from "../repositories/database.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { DryRunService } from "../services/dryRunService.js";
import { DraftSaveService } from "../services/draftSaveService.js";
import { BatchExecutionService } from "../services/batchExecutionService.js";
import { ArticleQueueRoutingService } from "../services/articleQueueRoutingService.js";
import { ArticleGenerationPackageService } from "../services/articleGenerationPackageService.js";
import { GeneratedArticleImportService } from "../services/generatedArticleImportService.js";
import { GeneratedArticleBatchCompilerService } from "../services/generatedArticleBatchCompilerService.js";
import { BatchImageAttachmentService } from "../services/batchImageAttachmentService.js";
import { BatchSourceAttachmentService } from "../services/batchSourceAttachmentService.js";
import { ContentBatchCompilerService } from "../services/contentBatchCompilerService.js";
import { ContentBatchAuditService } from "../services/contentBatchAuditService.js";
import { ContentAuditRetryService } from "../services/contentAuditRetryService.js";
import { ContentRemediationPackageService } from "../services/contentRemediationPackageService.js";
import { ContentRemediationImportService } from "../services/contentRemediationImportService.js";
import { DraftSourceUpdateService } from "../services/draftSourceUpdateService.js";
import { OpenAIArticleGenerationService } from "../services/openAIArticleGenerationService.js";
import { OpenAIContentRemediationService } from "../services/openAIContentRemediationService.js";
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

async function writeNewJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
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
  if (args.command === "prepare-article-queue") {
    const inputPath = resolve(requiredString(args.options, "manifest"));
    const outputPath = resolve(requiredString(args.options, "output"));
    if (inputPath === outputPath) {
      throw new Error("Article queue input and output paths must differ");
    }
    const result = new ArticleQueueRoutingService().execute(await readJsonFile(inputPath));
    await writeNewJsonFile(outputPath, result.manifest);
    logger.info(
      { outputPath, assignments: result.assignments },
      "Article queue routed to batch manifest"
    );
    return;
  }
  if (args.command === "prepare-generation-package") {
    const inputPath = resolve(requiredString(args.options, "manifest"));
    const outputPath = resolve(requiredString(args.options, "output"));
    if (inputPath === outputPath) {
      throw new Error("Article generation plan and output paths must differ");
    }
    const result = new ArticleGenerationPackageService().execute(await readJsonFile(inputPath));
    await writeNewJsonFile(outputPath, result.package);
    logger.info(
      { outputPath, requestIds: result.package.requests.map((request) => request.requestId) },
      "Local article generation package prepared"
    );
    return;
  }
  if (args.command === "import-generated-articles") {
    const planPath = resolve(requiredString(args.options, "plan"));
    const responsesPath = resolve(requiredString(args.options, "responses"));
    const outputPath = resolve(requiredString(args.options, "output"));
    if (outputPath === planPath || outputPath === responsesPath) {
      throw new Error("Generated article import output must not overwrite an input file");
    }
    const queue = new GeneratedArticleImportService().execute(
      await readJsonFile(planPath),
      await readJsonFile(responsesPath)
    );
    await writeNewJsonFile(outputPath, queue);
    logger.info(
      { outputPath, requestCount: queue.items.length },
      "Generated articles validated and imported to local queue"
    );
    return;
  }
  if (args.command === "compile-generated-batch") {
    const planPath = resolve(requiredString(args.options, "plan"));
    const responsesPath = resolve(requiredString(args.options, "responses"));
    const outputPath = resolve(requiredString(args.options, "output"));
    if (outputPath === planPath || outputPath === responsesPath) {
      throw new Error("Generated batch output must not overwrite an input file");
    }
    const result = new GeneratedArticleBatchCompilerService().execute(
      await readJsonFile(planPath),
      await readJsonFile(responsesPath)
    );
    await writeNewJsonFile(outputPath, result.manifest);
    logger.info(
      {
        outputPath,
        requestIds: result.requestIds,
        assignments: result.assignments
      },
      "Generated articles validated and compiled to batch manifest"
    );
    return;
  }
  if (args.command === "attach-batch-images") {
    const manifestPath = resolve(requiredString(args.options, "manifest"));
    const imagesPath = resolve(requiredString(args.options, "images"));
    const outputPath = resolve(requiredString(args.options, "output"));
    if (outputPath === manifestPath || outputPath === imagesPath) {
      throw new Error("Image-attached batch output must not overwrite an input file");
    }
    const result = await new BatchImageAttachmentService().execute(
      await readJsonFile(manifestPath),
      await readJsonFile(imagesPath)
    );
    await writeNewJsonFile(outputPath, result.manifest);
    logger.info(
      { outputPath, images: result.images },
      "Validated images attached to local batch manifest"
    );
    return;
  }
  if (args.command === "attach-batch-sources") {
    const manifestPath = resolve(requiredString(args.options, "manifest"));
    const sourcesPath = resolve(requiredString(args.options, "sources"));
    const outputPath = resolve(requiredString(args.options, "output"));
    if (outputPath === manifestPath || outputPath === sourcesPath) {
      throw new Error("Source-attached batch output must not overwrite an input file");
    }
    const result = new BatchSourceAttachmentService().execute(
      await readJsonFile(manifestPath),
      await readJsonFile(sourcesPath)
    );
    await writeNewJsonFile(outputPath, result.manifest);
    logger.info(
      { outputPath, sources: result.sources },
      "Official sources attached to local batch manifest"
    );
    return;
  }
  if (args.command === "compile-content-batch") {
    const planPath = resolve(requiredString(args.options, "plan"));
    const responsesPath = resolve(requiredString(args.options, "responses"));
    const imagesPath = resolve(requiredString(args.options, "images"));
    const outputPath = resolve(requiredString(args.options, "output"));
    if ([planPath, responsesPath, imagesPath].includes(outputPath)) {
      throw new Error("Content batch output must not overwrite an input file");
    }
    const result = await new ContentBatchCompilerService().execute(
      await readJsonFile(planPath),
      await readJsonFile(responsesPath),
      await readJsonFile(imagesPath)
    );
    await writeNewJsonFile(outputPath, result.manifest);
    logger.info(
      {
        outputPath,
        requestIds: result.requestIds,
        assignments: result.assignments,
        images: result.images
      },
      "Generated articles and validated images compiled to local batch manifest"
    );
    return;
  }
  if (args.command === "audit-content-batch") {
    const manifestPath = resolve(requiredString(args.options, "manifest"));
    const outputPath = resolve(requiredString(args.options, "output"));
    if (outputPath === manifestPath) {
      throw new Error("Content audit output must not overwrite its batch input");
    }
    const result = await new ContentBatchAuditService().execute(await readJsonFile(manifestPath));
    await writeNewJsonFile(outputPath, result);
    logger.info(
      { outputPath, status: result.status, counts: result.counts },
      "Local content batch audit completed"
    );
    if (result.status === "FAIL") {
      throw new Error(`Content batch audit failed; inspect ${outputPath}`);
    }
    return;
  }
  if (args.command === "prepare-content-audit-retry") {
    const manifestPath = resolve(requiredString(args.options, "manifest"));
    const auditPath = resolve(requiredString(args.options, "audit"));
    const outputPath = resolve(requiredString(args.options, "output"));
    if (outputPath === manifestPath || outputPath === auditPath) {
      throw new Error("Content audit retry output must not overwrite an input file");
    }
    const result = new ContentAuditRetryService().execute(
      await readJsonFile(manifestPath),
      await readJsonFile(auditPath)
    );
    await writeNewJsonFile(outputPath, result.manifest);
    logger.info(
      { outputPath, failedAssignments: result.failedAssignments },
      "Content audit retry batch prepared"
    );
    return;
  }
  if (args.command === "prepare-content-remediation-package") {
    const manifestPath = resolve(requiredString(args.options, "manifest"));
    const auditPath = resolve(requiredString(args.options, "audit"));
    const outputPath = resolve(requiredString(args.options, "output"));
    if (outputPath === manifestPath || outputPath === auditPath) {
      throw new Error("Content remediation output must not overwrite an input file");
    }
    const remediationPackage = new ContentRemediationPackageService().execute(
      await readJsonFile(manifestPath),
      await readJsonFile(auditPath)
    );
    await writeNewJsonFile(outputPath, remediationPackage);
    logger.info(
      {
        outputPath,
        remediationIds: remediationPackage.requests.map((request) => request.remediationId)
      },
      "Local content remediation package prepared"
    );
    return;
  }
  if (args.command === "import-content-remediations") {
    const manifestPath = resolve(requiredString(args.options, "manifest"));
    const packagePath = resolve(requiredString(args.options, "package"));
    const responsesPath = resolve(requiredString(args.options, "responses"));
    const outputPath = resolve(requiredString(args.options, "output"));
    if ([manifestPath, packagePath, responsesPath].includes(outputPath)) {
      throw new Error("Content remediation import output must not overwrite an input file");
    }
    const result = new ContentRemediationImportService().execute(
      await readJsonFile(manifestPath),
      await readJsonFile(packagePath),
      await readJsonFile(responsesPath)
    );
    await writeNewJsonFile(outputPath, result.manifest);
    logger.info(
      { outputPath, importedAssignments: result.importedAssignments },
      "Corrected content validated and imported to a local retry batch"
    );
    return;
  }
  if (args.command === "update-draft-sources") {
    const manifestPath = resolve(requiredString(args.options, "manifest"));
    const manifestInput = await readJsonFile<unknown>(manifestPath);
    const manifest = batchManifestSchema.parse(manifestInput);
    const selectorPaths = new Set(manifest.blogs.map((blog) => blog.blogger.selectorsPath));
    if (selectorPaths.size !== 1) {
      throw new Error("Draft source update requires one shared Blogger selectors file");
    }
    const selectors = await loadBloggerSelectors([...selectorPaths][0]);
    const result = await new DraftSourceUpdateService(config, selectors).execute(manifest);
    logger.info(
      { reportPath: result.reportPath, counts: result.counts },
      "Blogger draft official sources updated"
    );
    return;
  }
  if (args.command === "estimate-openai-generation") {
    const packagePath = resolve(requiredString(args.options, "package"));
    const result = new OpenAIArticleGenerationService(config).estimate(
      await readJsonFile(packagePath)
    );
    logger.info(result.estimate, "OpenAI article generation maximum cost estimate");
    return;
  }
  if (args.command === "generate-openai-articles") {
    const packagePath = resolve(requiredString(args.options, "package"));
    const outputPath = resolve(requiredString(args.options, "output"));
    const confirmationText = requiredString(args.options, "confirm-max-cost-cents");
    if (!/^[1-9]\d*$/.test(confirmationText)) {
      throw new Error("OpenAI cost confirmation must be a positive integer number of cents");
    }
    if (outputPath === packagePath) {
      throw new Error("OpenAI generation output must not overwrite its package input");
    }
    const packageInput = await readJsonFile<unknown>(packagePath);
    const service = new OpenAIArticleGenerationService(config);
    const preflight = service.estimate(packageInput);
    const confirmedMaximumCostCents = Number(confirmationText);
    if (confirmedMaximumCostCents !== preflight.estimate.maximumCostCents) {
      throw new Error(
        `Cost confirmation must exactly match ${preflight.estimate.maximumCostCents} cents`
      );
    }
    if (!config.ENABLE_ARTICLE_GENERATION) {
      throw new Error("OpenAI article generation requires ENABLE_ARTICLE_GENERATION=true");
    }
    if (!config.OPENAI_API_KEY) {
      throw new Error("OpenAI article generation requires OPENAI_API_KEY");
    }
    const attemptPath = `${outputPath}.attempt.json`;
    const outputHandle = await open(outputPath, "wx");
    let result: Awaited<ReturnType<OpenAIArticleGenerationService["execute"]>>;
    try {
      await writeNewJsonFile(attemptPath, {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        packageSha256: createHash("sha256").update(JSON.stringify(preflight.package)).digest("hex"),
        estimate: preflight.estimate
      });
      result = await service.execute(packageInput, confirmedMaximumCostCents);
      await outputHandle.writeFile(`${JSON.stringify(result.responses, null, 2)}\n`, "utf8");
    } finally {
      await outputHandle.close();
    }
    logger.info(
      {
        outputPath,
        attemptPath,
        responseId: result.responseId,
        estimate: result.estimate
      },
      "OpenAI article generation completed"
    );
    return;
  }
  if (args.command === "estimate-openai-remediations") {
    const packagePath = resolve(requiredString(args.options, "package"));
    const result = new OpenAIContentRemediationService(config).estimate(
      await readJsonFile(packagePath)
    );
    logger.info(result.estimate, "OpenAI content remediation maximum cost estimate");
    return;
  }
  if (args.command === "generate-openai-remediations") {
    const packagePath = resolve(requiredString(args.options, "package"));
    const outputPath = resolve(requiredString(args.options, "output"));
    const confirmationText = requiredString(args.options, "confirm-max-cost-cents");
    if (!/^[1-9]\d*$/.test(confirmationText)) {
      throw new Error("OpenAI cost confirmation must be a positive integer number of cents");
    }
    if (outputPath === packagePath) {
      throw new Error("OpenAI remediation output must not overwrite its package input");
    }
    const packageInput = await readJsonFile<unknown>(packagePath);
    const service = new OpenAIContentRemediationService(config);
    const preflight = service.estimate(packageInput);
    const confirmedMaximumCostCents = Number(confirmationText);
    if (confirmedMaximumCostCents !== preflight.estimate.maximumCostCents) {
      throw new Error(
        `Cost confirmation must exactly match ${preflight.estimate.maximumCostCents} cents`
      );
    }
    if (!config.ENABLE_ARTICLE_GENERATION || !config.OPENAI_API_KEY) {
      throw new Error(
        "OpenAI content remediation requires ENABLE_ARTICLE_GENERATION=true and OPENAI_API_KEY"
      );
    }
    const attemptPath = `${outputPath}.attempt.json`;
    const outputHandle = await open(outputPath, "wx");
    let result: Awaited<ReturnType<OpenAIContentRemediationService["execute"]>>;
    try {
      await writeNewJsonFile(attemptPath, {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        packageSha256: createHash("sha256").update(JSON.stringify(preflight.package)).digest("hex"),
        estimate: preflight.estimate
      });
      result = await service.execute(packageInput, confirmedMaximumCostCents);
      await outputHandle.writeFile(`${JSON.stringify(result.responses, null, 2)}\n`, "utf8");
    } finally {
      await outputHandle.close();
    }
    logger.info(
      { outputPath, attemptPath, responseId: result.responseId, estimate: result.estimate },
      "OpenAI content remediation completed"
    );
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
  prepare-generation-package --manifest <path> --output <path>
  import-generated-articles --plan <path> --responses <path> --output <path>
  compile-generated-batch --plan <path> --responses <path> --output <path>
  attach-batch-images --manifest <path> --images <path> --output <path>
  attach-batch-sources --manifest <path> --sources <path> --output <path>
  compile-content-batch --plan <path> --responses <path> --images <path> --output <path>
  audit-content-batch --manifest <path> --output <path>
  prepare-content-audit-retry --manifest <path> --audit <path> --output <path>
  prepare-content-remediation-package --manifest <path> --audit <path> --output <path>
  import-content-remediations --manifest <path> --package <path> --responses <path> --output <path>
  update-draft-sources --manifest <path>
  estimate-openai-generation --package <path>
  generate-openai-articles --package <path> --output <path> --confirm-max-cost-cents <cents>
  estimate-openai-remediations --package <path>
  generate-openai-remediations --package <path> --output <path> --confirm-max-cost-cents <cents>
  prepare-article-queue --manifest <path> --output <path>
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
Prepare-generation-package exports sanitized editorial briefs without calling an AI provider.
Import-generated-articles validates AI output and source attestations before creating a local queue.
Estimate-openai-generation calculates a conservative maximum OpenAI token cost without an API call.
Generate-openai-articles requires an exact cost confirmation and leaves a durable one-attempt marker.
Prepare-article-queue validates and routes completed article candidates locally without opening Blogger.
Run-batch performs a validated multi-article dry-run, saves drafts, or creates local schedule plans.
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
