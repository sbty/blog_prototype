import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { openChromeForManualLogin } from "../browser/chromeProfile.js";
import { BloggerDryRunClient } from "../browser/bloggerDryRun.js";
import { loadBloggerSelectors } from "../browser/bloggerSelectors.js";
import { blogConfigSchema } from "../config/blogConfig.js";
import { loadConfig } from "../config/env.js";
import { articleInputSchema } from "../domain/article.js";
import {
  publicationMonitorBatchManifestSchema,
  publicationMonitorFileSchema,
  publicationMonitorScheduleAuditSchema
} from "../domain/publicationMonitor.js";
import { batchManifestSchema } from "../domain/batch.js";
import { existingDraftAuditBatchManifestSchema } from "../domain/existingDraftAuditBatch.js";
import { existingDraftAuditSelectionManifestSchema } from "../domain/existingDraftAuditSelection.js";
import { existingDraftAuditSelectionPreparationManifestSchema } from "../domain/existingDraftAuditSelectionPreparation.js";
import { createLogger } from "../logging/logger.js";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { withMigratedDatabase } from "../repositories/database.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { DryRunService } from "../services/dryRunService.js";
import { DraftSaveService } from "../services/draftSaveService.js";
import { ExistingDraftCompleteAuditService } from "../services/existingDraftCompleteAuditService.js";
import {
  ExistingDraftCompleteAuditBatchService,
  summarizeExistingDraftCompleteAuditBatch,
  type ExistingDraftCompleteAuditBatchItemInput
} from "../services/existingDraftCompleteAuditBatchService.js";
import {
  ExistingDraftAuditSelectionService,
  type ExistingDraftAuditSelectionItemInput
} from "../services/existingDraftAuditSelectionService.js";
import { ExistingDraftAuditSelectionPreparationService } from "../services/existingDraftAuditSelectionPreparationService.js";
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
import { PublishedPostCompleteAuditService } from "../services/publishedPostCompleteAuditService.js";
import {
  buildScheduledPermalinkReauditRepairReport,
  ScheduledPermalinkAuditService,
  type ScheduledPermalinkAuditItem,
  type ScheduledPermalinkAuditTarget
} from "../services/scheduledPermalinkAuditService.js";
import { ScheduledPermalinkRepairPreparationService } from "../services/scheduledPermalinkRepairPreparationService.js";
import {
  PublicationMonitorBatchService,
  type PublicationMonitorCanonicalItem,
  type PublicationMonitorSource
} from "../services/publicationMonitorBatchService.js";
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

function prepareExistingDraftUpdateBatch(manifestInput: unknown, targetsInput: unknown) {
  const manifest = batchManifestSchema.parse(manifestInput);
  if (manifest.operation !== "save-drafts") {
    throw new Error("Existing draft update requires a save-drafts batch manifest");
  }
  if (
    !targetsInput ||
    typeof targetsInput !== "object" ||
    !Array.isArray((targetsInput as { targets?: unknown }).targets)
  ) {
    throw new Error("Existing draft update targets must contain a targets array");
  }
  const targets = (targetsInput as { targets: unknown[] }).targets.map((value) => {
    if (!value || typeof value !== "object")
      throw new Error("Existing draft update target must be an object");
    const target = value as Record<string, unknown>;
    if (
      typeof target.blogKey !== "string" ||
      typeof target.slug !== "string" ||
      typeof target.postEditorUrl !== "string"
    ) {
      throw new Error("Existing draft update target requires blogKey, slug, and postEditorUrl");
    }
    const postEditorUrl = new URL(target.postEditorUrl);
    if (
      postEditorUrl.protocol !== "https:" ||
      !["www.blogger.com", "blogger.com"].includes(postEditorUrl.hostname) ||
      !/^\/blog\/post\/edit\/\d+\/\d+\/?$/.test(postEditorUrl.pathname) ||
      postEditorUrl.search ||
      postEditorUrl.hash
    ) {
      throw new Error("Existing draft update target must use a canonical Blogger post editor URL");
    }
    return { blogKey: target.blogKey, slug: target.slug, postEditorUrl: target.postEditorUrl };
  });
  const keys = new Set<string>();
  for (const target of targets) {
    const key = `${target.blogKey}\0${target.slug}`;
    if (keys.has(key))
      throw new Error(`Duplicate existing draft update target: ${target.blogKey}/${target.slug}`);
    keys.add(key);
  }
  if (targets.length === 0) throw new Error("Existing draft update requires at least one target");

  const blogs = new Map(manifest.blogs.map((blog) => [blog.blogKey, blog]));
  const items = targets.map((target) => {
    const blog = blogs.get(target.blogKey);
    const item = manifest.items.find(
      (candidate) => candidate.blogKey === target.blogKey && candidate.article.slug === target.slug
    );
    if (!blog || !item) {
      throw new Error(
        `Existing draft update target is not in the batch: ${target.blogKey}/${target.slug}`
      );
    }
    const expectedBlogId = new URL(blog.adminUrl).pathname.match(/^\/blog\/posts\/(\d+)/)?.[1];
    const targetBlogId = new URL(target.postEditorUrl).pathname.match(
      /^\/blog\/post\/edit\/(\d+)\//
    )?.[1];
    if (!expectedBlogId || expectedBlogId !== targetBlogId) {
      throw new Error(
        `Existing draft update target belongs to a different blog: ${target.blogKey}/${target.slug}`
      );
    }
    return item;
  });
  const selectedBlogs = targets.map((target) => {
    const blog = blogs.get(target.blogKey)!;
    return { ...blog, blogger: { ...blog.blogger, postEditorUrl: target.postEditorUrl } };
  });
  return batchManifestSchema.parse({
    operation: "save-drafts",
    continueOnError: true,
    blogs: selectedBlogs,
    items
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
  if (args.command === "audit-published-post-complete") {
    const blog = blogConfigSchema.parse(await readJsonFile(requiredString(args.options, "blog")));
    const article = articleInputSchema.parse(
      await readJsonFile(requiredString(args.options, "article"))
    );
    const outputPath = resolve(requiredString(args.options, "output"));
    const report = await new PublishedPostCompleteAuditService(config).execute({
      blog,
      article,
      postId: requiredString(args.options, "post-id"),
      postEditorUrl: requiredString(args.options, "editor-url")
    });
    await writeNewJsonFile(outputPath, report);
    logger.info(
      { outputPath, status: report.status, reasons: report.reasons },
      "Published post complete audit result"
    );
    return;
  }
  if (args.command === "audit-scheduled-permalinks") {
    const selectionPath = resolve(requiredString(args.options, "selection"));
    const reconciliationPath = resolve(requiredString(args.options, "reconciliation"));
    const outputPath = resolve(requiredString(args.options, "output"));
    const selection = existingDraftAuditSelectionManifestSchema.parse(
      await readJsonFile<unknown>(selectionPath)
    );
    const reconciliation = await readJsonFile<{ items?: unknown }>(reconciliationPath);
    if (!reconciliation.items || !Array.isArray(reconciliation.items)) {
      throw new Error("Scheduled permalink audit reconciliation must contain items");
    }
    const canonicalItems = await Promise.all(
      selection.items.map(async (item) => ({
        ...item,
        blog: blogConfigSchema.parse(
          await readJsonFile(resolve(dirname(selectionPath), item.blogPath))
        ),
        article: articleInputSchema.parse(
          await readJsonFile(resolve(dirname(selectionPath), item.articlePath))
        )
      }))
    );
    const canonicalByKey = new Map(
      canonicalItems.map((item) => [`${item.batch}\0${item.blog.blogKey}\0${item.slug}`, item])
    );
    const targets: ScheduledPermalinkAuditTarget[] = reconciliation.items.flatMap((value) => {
      if (!value || typeof value !== "object")
        throw new Error("Scheduled permalink reconciliation item must be an object");
      const item = value as Record<string, unknown>;
      if (item.currentState !== "SCHEDULED") return [];
      if (
        typeof item.batch !== "string" ||
        typeof item.blogKey !== "string" ||
        typeof item.slug !== "string" ||
        typeof item.postId !== "string" ||
        typeof item.expectedSchedule !== "string"
      ) {
        throw new Error(
          "Scheduled permalink reconciliation item is missing identity or schedule evidence"
        );
      }
      const canonical = canonicalByKey.get(`${item.batch}\0${item.blogKey}\0${item.slug}`);
      if (!canonical || canonical.postId !== item.postId) {
        throw new Error(
          `Scheduled permalink canonical source mismatch: ${item.batch}/${item.slug}`
        );
      }
      if (canonical.article.title !== item.title) {
        throw new Error(`Scheduled permalink title mismatch: ${item.batch}/${item.slug}`);
      }
      return [
        {
          batch: canonical.batch,
          blog: canonical.blog,
          article: canonical.article,
          postId: canonical.postId,
          postEditorUrl: canonical.postEditorUrl,
          scheduledAtJst: item.expectedSchedule
        }
      ];
    });
    const service = new ScheduledPermalinkAuditService(
      async (blog) =>
        new BloggerDryRunClient(config, await loadBloggerSelectors(blog.blogger.selectorsPath))
    );
    service.validatePreflight(targets);
    await mkdir(outputPath, { recursive: false });
    const report = await service.execute(targets);
    const reportPath = join(outputPath, "scheduled-permalink-audit-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    logger.info(
      { outputPath, reportPath, counts: report.counts },
      "Scheduled permalink audit result"
    );
    return;
  }
  if (args.command === "reaudit-scheduled-permalink-unverified") {
    const selectionPath = resolve(requiredString(args.options, "selection"));
    const previousReportPath = resolve(requiredString(args.options, "previous-report"));
    const outputPath = resolve(requiredString(args.options, "output"));
    const selection = existingDraftAuditSelectionManifestSchema.parse(
      await readJsonFile<unknown>(selectionPath)
    );
    const previous = await readJsonFile<{ items?: unknown }>(previousReportPath);
    if (!Array.isArray(previous.items)) {
      throw new Error("Scheduled permalink re-audit report must contain items");
    }
    const priorItems = previous.items.map((value): ScheduledPermalinkAuditItem => {
      if (!value || typeof value !== "object")
        throw new Error("Scheduled permalink re-audit item must be an object");
      const item = value as Record<string, unknown>;
      if (
        typeof item.batch !== "string" ||
        typeof item.blogKey !== "string" ||
        typeof item.slug !== "string" ||
        typeof item.postId !== "string" ||
        typeof item.postEditorUrl !== "string" ||
        typeof item.expectedScheduledAtJst !== "string" ||
        (item.status !== "PASS" && item.status !== "FAIL" && item.status !== "UNVERIFIED") ||
        (item.permalink !== "MATCH" &&
          item.permalink !== "EMPTY" &&
          item.permalink !== "DIFFERENT" &&
          item.permalink !== "UNVERIFIED") ||
        !Array.isArray(item.reasons) ||
        typeof item.attempts !== "number" ||
        typeof item.auditedAt !== "string"
      ) {
        throw new Error("Scheduled permalink re-audit item is missing required audit fields");
      }
      return item as unknown as ScheduledPermalinkAuditItem;
    });
    const canonicalItems = await Promise.all(
      selection.items.map(async (item) => ({
        ...item,
        blog: blogConfigSchema.parse(
          await readJsonFile(resolve(dirname(selectionPath), item.blogPath))
        ),
        article: articleInputSchema.parse(
          await readJsonFile(resolve(dirname(selectionPath), item.articlePath))
        )
      }))
    );
    const canonicalByKey = new Map(
      canonicalItems.map((item) => [`${item.batch}\0${item.blog.blogKey}\0${item.slug}`, item])
    );
    const targets: ScheduledPermalinkAuditTarget[] = priorItems
      .filter((item) => item.status === "UNVERIFIED")
      .map((item) => {
        const canonical = canonicalByKey.get(`${item.batch}\0${item.blogKey}\0${item.slug}`);
        if (
          !canonical ||
          canonical.postId !== item.postId ||
          canonical.postEditorUrl !== item.postEditorUrl
        ) {
          throw new Error(
            `Scheduled permalink re-audit canonical source mismatch: ${item.batch}/${item.slug}`
          );
        }
        return {
          batch: canonical.batch,
          blog: canonical.blog,
          article: canonical.article,
          postId: canonical.postId,
          postEditorUrl: canonical.postEditorUrl,
          scheduledAtJst: item.expectedScheduledAtJst
        };
      });
    if (targets.length === 0)
      throw new Error("Scheduled permalink re-audit has no UNVERIFIED targets");
    const service = new ScheduledPermalinkAuditService(
      async (blog) =>
        new BloggerDryRunClient(config, await loadBloggerSelectors(blog.blogger.selectorsPath)),
      () => new Date(),
      4,
      2
    );
    service.validatePreflight(targets);
    await mkdir(outputPath, { recursive: false });
    const reaudited = await service.execute(targets);
    const report = buildScheduledPermalinkReauditRepairReport({
      priorReportPath: previousReportPath,
      priorItems,
      reauditedItems: reaudited.items
    });
    const reportPath = join(outputPath, "scheduled-permalink-reaudit-repair-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    logger.info(
      { outputPath, reportPath, counts: report.counts },
      "Scheduled permalink re-audit result"
    );
    return;
  }
  if (args.command === "prepare-scheduled-permalink-repair") {
    const selectionPath = resolve(requiredString(args.options, "selection"));
    const auditPath = resolve(requiredString(args.options, "audit"));
    const outputPath = resolve(requiredString(args.options, "output"));
    const selection = existingDraftAuditSelectionManifestSchema.parse(
      await readJsonFile<unknown>(selectionPath)
    );
    const audit = await readJsonFile<{ items?: unknown; candidates?: unknown }>(auditPath);
    if (!Array.isArray(audit.items) || !audit.candidates || typeof audit.candidates !== "object") {
      throw new Error(
        "Scheduled permalink repair preparation audit must contain items and candidates"
      );
    }
    const parseItem = (value: unknown): ScheduledPermalinkAuditItem => {
      if (!value || typeof value !== "object")
        throw new Error("Scheduled permalink repair preparation item must be an object");
      const item = value as Record<string, unknown>;
      if (
        typeof item.batch !== "string" ||
        typeof item.blogKey !== "string" ||
        typeof item.slug !== "string" ||
        typeof item.postId !== "string" ||
        typeof item.postEditorUrl !== "string" ||
        typeof item.expectedScheduledAtJst !== "string" ||
        (item.status !== "PASS" && item.status !== "FAIL" && item.status !== "UNVERIFIED") ||
        (item.permalink !== "MATCH" &&
          item.permalink !== "EMPTY" &&
          item.permalink !== "DIFFERENT" &&
          item.permalink !== "UNVERIFIED") ||
        !Array.isArray(item.reasons) ||
        typeof item.attempts !== "number" ||
        typeof item.auditedAt !== "string"
      ) {
        throw new Error(
          "Scheduled permalink repair preparation item is missing required audit fields"
        );
      }
      return item as unknown as ScheduledPermalinkAuditItem;
    };
    const candidateInput = audit.candidates as Record<string, unknown>;
    const category = (
      name: "PERMALINK_ONLY" | "CANONICAL_DIFFERENCE" | "CONNECTION_UNVERIFIED"
    ) => {
      const values = candidateInput[name];
      if (!Array.isArray(values))
        throw new Error(`Scheduled permalink repair preparation is missing ${name}`);
      return values.map(parseItem);
    };
    const canonicalSources = await Promise.all(
      selection.items.map(async (item) => {
        const blog = blogConfigSchema.parse(
          await readJsonFile(resolve(dirname(selectionPath), item.blogPath))
        );
        return {
          batch: item.batch,
          blogKey: blog.blogKey,
          slug: item.slug,
          postId: item.postId,
          postEditorUrl: item.postEditorUrl,
          blogPath: item.blogPath,
          articlePath: item.articlePath
        };
      })
    );
    const report = new ScheduledPermalinkRepairPreparationService().prepare({
      auditReportPath: auditPath,
      selectionManifestPath: selectionPath,
      items: audit.items.map(parseItem),
      candidates: {
        PERMALINK_ONLY: category("PERMALINK_ONLY"),
        CANONICAL_DIFFERENCE: category("CANONICAL_DIFFERENCE"),
        CONNECTION_UNVERIFIED: category("CONNECTION_UNVERIFIED")
      },
      canonicalSources
    });
    await mkdir(outputPath, { recursive: false });
    const reportPath = join(outputPath, "scheduled-permalink-repair-approval-package.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    logger.info(
      { outputPath, reportPath, counts: report.counts },
      "Scheduled permalink repair preparation result"
    );
    return;
  }
  if (args.command === "audit-publication-monitors") {
    const manifestPath = resolve(requiredString(args.options, "manifest"));
    const outputPath = resolve(requiredString(args.options, "output"));
    const manifest = publicationMonitorBatchManifestSchema.parse(
      await readJsonFile<unknown>(manifestPath)
    );
    const selectionPath = resolve(dirname(manifestPath), manifest.canonicalSelectionPath);
    const selection = existingDraftAuditSelectionManifestSchema.parse(
      await readJsonFile<unknown>(selectionPath)
    );
    const canonicalItems: PublicationMonitorCanonicalItem[] = await Promise.all(
      selection.items.map(async (item) => ({
        batch: item.batch,
        slug: item.slug,
        blog: blogConfigSchema.parse(
          await readJsonFile(resolve(dirname(selectionPath), item.blogPath))
        ),
        article: articleInputSchema.parse(
          await readJsonFile(resolve(dirname(selectionPath), item.articlePath))
        ),
        postId: item.postId,
        postEditorUrl: item.postEditorUrl
      }))
    );
    const sources: PublicationMonitorSource[] = await Promise.all(
      manifest.monitors.map(async (source) => ({
        batch: source.batch,
        path: resolve(dirname(manifestPath), source.monitorPath),
        monitor: publicationMonitorFileSchema.parse(
          await readJsonFile(resolve(dirname(manifestPath), source.monitorPath))
        )
      }))
    );
    const scheduleAudits = await Promise.all(
      manifest.monitors.map(async (source) => ({
        batch: source.batch,
        schedule: publicationMonitorScheduleAuditSchema.parse(
          await readJsonFile(resolve(dirname(manifestPath), source.scheduleAuditPath))
        )
      }))
    );
    const normalizeJst = (value: string) => {
      const normalized = value.replace(
        /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})$/,
        (_match, year, month, day, hour, minute) =>
          `${year}-${month}-${day} ${hour.padStart(2, "0")}:${minute} JST`
      );
      return / JST$/.test(normalized) ? normalized : `${normalized} JST`;
    };
    for (const source of sources) {
      const schedule = scheduleAudits.find((entry) => entry.batch === source.batch)?.schedule;
      const entries = schedule?.items ?? schedule?.targets ?? [];
      for (const item of source.monitor.items) {
        const expected = entries.find((entry) => entry.slug === item.slug);
        if (
          !expected ||
          expected.postId !== item.postId ||
          normalizeJst(expected.scheduledAtJst) !== normalizeJst(item.scheduledAtJst)
        ) {
          throw new Error(`Monitor schedule evidence does not match: ${source.batch}/${item.slug}`);
        }
      }
    }
    const completeAudit = new PublishedPostCompleteAuditService(config);
    const service = new PublicationMonitorBatchService({
      audit: (item) => completeAudit.execute(item)
    });
    service.validatePreflight({ monitors: sources, canonicalItems });
    await mkdir(outputPath, { recursive: false });
    const retryUnverified = args.options["retry-unverified"] === "true";
    if (args.options["retry-unverified"] && !retryUnverified)
      throw new Error("--retry-unverified must be true");
    const result = await service.execute({ monitors: sources, canonicalItems, retryUnverified });
    const reportPath = join(outputPath, "publication-monitor-batch-report.json");
    await writeFile(reportPath, `${JSON.stringify(result.report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    for (const source of result.monitors) {
      await writeFile(source.path, `${JSON.stringify(source.monitor, null, 2)}\n`, {
        encoding: "utf8"
      });
    }
    logger.info(
      { outputPath, reportPath, counts: result.report.counts },
      "Publication monitor batch audit result"
    );
    return;
  }
  if (args.command === "audit-existing-draft") {
    const blog = blogConfigSchema.parse(await readJsonFile(requiredString(args.options, "blog")));
    const article = articleInputSchema.parse(
      await readJsonFile(requiredString(args.options, "article"))
    );
    const outputPath = resolve(requiredString(args.options, "output"));
    const report = await new ExistingDraftCompleteAuditService(config).execute({
      blog,
      article,
      postId: requiredString(args.options, "post-id"),
      postEditorUrl: requiredString(args.options, "editor-url")
    });
    await writeNewJsonFile(outputPath, report);
    logger.info(
      { outputPath, status: report.status, reasons: report.reasons },
      "Existing draft audit result"
    );
    return;
  }
  if (args.command === "audit-existing-draft-batch") {
    const manifestPath = resolve(requiredString(args.options, "manifest"));
    const outputPath = resolve(requiredString(args.options, "output"));
    const manifest = existingDraftAuditBatchManifestSchema.parse(
      await readJsonFile<unknown>(manifestPath)
    );
    const items: ExistingDraftCompleteAuditBatchItemInput[] = await Promise.all(
      manifest.items.map(async (item) => ({
        ...item,
        blog: blogConfigSchema.parse(
          await readJsonFile(resolve(dirname(manifestPath), item.blogPath))
        ),
        article: articleInputSchema.parse(
          await readJsonFile(resolve(dirname(manifestPath), item.articlePath))
        )
      }))
    );
    const service = new ExistingDraftCompleteAuditBatchService(config);
    service.validatePreflight(items);
    await mkdir(outputPath, { recursive: false });
    const report = await service.execute({ items });
    const detailFile = (item: { index: number; slug: string }) =>
      `${String(item.index + 1).padStart(2, "0")}-${item.slug}.json`;
    for (const item of report.items) {
      const outputFile = join(outputPath, detailFile(item));
      await writeFile(outputFile, `${JSON.stringify(item, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
    }
    const summary = summarizeExistingDraftCompleteAuditBatch(report, detailFile);
    const summaryPath = join(outputPath, "summary.json");
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    logger.info(
      { outputPath, summaryPath, status: summary.status, counts: summary.counts },
      "Existing draft batch audit result"
    );
    return;
  }
  if (args.command === "select-existing-draft-audit-targets") {
    const manifestPath = resolve(requiredString(args.options, "manifest"));
    const outputPath = resolve(requiredString(args.options, "output"));
    const manifest = existingDraftAuditSelectionManifestSchema.parse(
      await readJsonFile<unknown>(manifestPath)
    );
    const items: ExistingDraftAuditSelectionItemInput[] = await Promise.all(
      manifest.items.map(async (item) => ({
        ...item,
        blog: blogConfigSchema.parse(
          await readJsonFile(resolve(dirname(manifestPath), item.blogPath))
        ),
        article: articleInputSchema.parse(
          await readJsonFile(resolve(dirname(manifestPath), item.articlePath))
        )
      }))
    );
    const selectorsByPath = new Map<string, Awaited<ReturnType<typeof loadBloggerSelectors>>>();
    const client = {
      listPosts: async (input: { adminUrl: string }) => {
        const item = items.find((candidate) => candidate.blog.adminUrl === input.adminUrl);
        if (!item) throw new Error(`No local blog configuration for ${input.adminUrl}`);
        const selectorsPath = item.blog.blogger.selectorsPath;
        let selectors = selectorsByPath.get(selectorsPath);
        if (!selectors) {
          selectors = await loadBloggerSelectors(selectorsPath);
          selectorsByPath.set(selectorsPath, selectors);
        }
        return new BloggerDryRunClient(config, selectors).listPosts(input);
      },
      inspectExistingDraft: async (input: { adminUrl: string; postEditorUrl: string }) => {
        const item = items.find((candidate) => candidate.blog.adminUrl === input.adminUrl);
        if (!item) throw new Error(`No local blog configuration for ${input.adminUrl}`);
        const selectorsPath = item.blog.blogger.selectorsPath;
        let selectors = selectorsByPath.get(selectorsPath);
        if (!selectors) {
          selectors = await loadBloggerSelectors(selectorsPath);
          selectorsByPath.set(selectorsPath, selectors);
        }
        return new BloggerDryRunClient(config, selectors).inspectExistingDraft(input);
      }
    };
    const service = new ExistingDraftAuditSelectionService(client);
    service.validatePreflight(items);
    await mkdir(outputPath, { recursive: false });
    const report = await service.execute({ items });
    const reportPath = join(outputPath, "selection-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    let auditManifestPath: string | undefined;
    if (report.auditManifest) {
      auditManifestPath = join(outputPath, "audit-existing-drafts.manifest.json");
      await writeFile(auditManifestPath, `${JSON.stringify(report.auditManifest, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
    }
    logger.info(
      { outputPath, reportPath, auditManifestPath, status: report.status, counts: report.counts },
      "Existing draft audit target selection result"
    );
    return;
  }
  if (args.command === "prepare-existing-draft-audit-selection") {
    const manifestPath = resolve(requiredString(args.options, "manifest"));
    const outputPath = resolve(requiredString(args.options, "output"));
    const manifest = existingDraftAuditSelectionPreparationManifestSchema.parse(
      await readJsonFile<unknown>(manifestPath)
    );
    const evidenceIssues = new Map<string, string>();
    await Promise.all(
      manifest.items.map(async (item) => {
        const evidencePaths = Object.values(item.provenance);
        try {
          const texts = await Promise.all(
            evidencePaths.map((path) => readFile(resolve(dirname(manifestPath), path), "utf8"))
          );
          if (
            texts.some((text) => !text.includes(item.slug) || /"status"\s*:\s*"FAIL"/.test(text))
          ) {
            evidenceIssues.set(
              `${item.blogKey}\0${item.slug}`,
              "Local generation, save, reservation, or readiness evidence is missing the canonical slug or records FAIL"
            );
          }
        } catch {
          evidenceIssues.set(
            `${item.blogKey}\0${item.slug}`,
            "Local generation, save, reservation, or readiness evidence file is missing or unreadable"
          );
        }
      })
    );
    const report = new ExistingDraftAuditSelectionPreparationService().execute(
      manifest,
      evidenceIssues
    );
    await mkdir(outputPath, { recursive: false });
    const reportPath = join(outputPath, "preparation-report.json");
    const selectionManifestPath = join(outputPath, "selection.manifest.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    const selectionManifest = {
      ...report.selectionManifest,
      items: report.selectionManifest.items.map((item) => ({
        ...item,
        blogPath: relative(outputPath, resolve(dirname(manifestPath), item.blogPath)),
        articlePath: relative(outputPath, resolve(dirname(manifestPath), item.articlePath))
      }))
    };
    await writeFile(selectionManifestPath, `${JSON.stringify(selectionManifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    logger.info(
      {
        outputPath,
        reportPath,
        selectionManifestPath,
        status: report.status,
        counts: report.counts
      },
      "Existing draft audit selection preparation result"
    );
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
    const sourcesPath = resolve(requiredString(args.options, "sources"));
    const outputPath = resolve(requiredString(args.options, "output"));
    if ([planPath, responsesPath, imagesPath, sourcesPath].includes(outputPath)) {
      throw new Error("Content batch output must not overwrite an input file");
    }
    const result = await new ContentBatchCompilerService().execute(
      await readJsonFile(planPath),
      await readJsonFile(responsesPath),
      await readJsonFile(imagesPath),
      await readJsonFile(sourcesPath)
    );
    await writeNewJsonFile(outputPath, result.manifest);
    logger.info(
      {
        outputPath,
        requestIds: result.requestIds,
        assignments: result.assignments,
        images: result.images,
        sources: result.sources
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
    const usagePath = `${outputPath}.usage.json`;
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
      await writeNewJsonFile(usagePath, {
        schemaVersion: 1,
        responseId: result.responseId,
        estimate: result.estimate,
        usage: result.usage
      });
    } finally {
      await outputHandle.close();
    }
    logger.info(
      {
        outputPath,
        attemptPath,
        usagePath,
        responseId: result.responseId,
        estimate: result.estimate,
        usage: result.usage
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
    if (args.command === "update-existing-drafts") {
      if (!config.ENABLE_EXISTING_DRAFT_UPDATE) {
        throw new Error("Existing draft update requires ENABLE_EXISTING_DRAFT_UPDATE=true");
      }
      const manifest = prepareExistingDraftUpdateBatch(
        await readJsonFile<unknown>(requiredString(args.options, "manifest")),
        await readJsonFile<unknown>(requiredString(args.options, "targets"))
      );
      const draftService = new DraftSaveService(config, repos, logger);
      const result = await new BatchExecutionService(
        config,
        {
          dryRun: async () => {
            throw new Error("Existing draft update does not support dry-run items");
          },
          saveDraft: (input) => draftService.execute(input),
          planSchedule: async () => {
            throw new Error("Existing draft update does not support schedule items");
          }
        },
        logger
      ).execute(manifest);
      logger.info(result, "Existing Blogger drafts updated");
      return;
    }
    if (args.command === "update-existing-draft-images") {
      if (!config.ENABLE_EXISTING_DRAFT_UPDATE) {
        throw new Error("Existing draft image update requires ENABLE_EXISTING_DRAFT_UPDATE=true");
      }
      const manifest = prepareExistingDraftUpdateBatch(
        await readJsonFile<unknown>(requiredString(args.options, "manifest")),
        await readJsonFile<unknown>(requiredString(args.options, "targets"))
      );
      const draftService = new DraftSaveService(config, repos, logger);
      const result = await new BatchExecutionService(
        config,
        {
          dryRun: async () => {
            throw new Error("Existing draft image update does not support dry-run items");
          },
          saveDraft: (input) => draftService.executeImageOnly(input),
          planSchedule: async () => {
            throw new Error("Existing draft image update does not support schedule items");
          }
        },
        logger
      ).execute(manifest);
      logger.info(result, "Existing Blogger draft images updated");
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
  audit-existing-draft --blog <path> --article <path> --post-id <id> --editor-url <url> --output <path>
  audit-existing-draft-batch --manifest <path> --output <new-directory>
  select-existing-draft-audit-targets --manifest <path> --output <new-directory>
  prepare-existing-draft-audit-selection --manifest <path> --output <new-directory>
  audit-published-post --blog <path> --article <path>
  audit-published-post-complete --blog <path> --article <path> --post-id <id> --editor-url <url> --output <path>
  audit-scheduled-permalinks --selection <path> --reconciliation <path> --output <new-directory>
  reaudit-scheduled-permalink-unverified --selection <path> --previous-report <path> --output <new-directory>
  prepare-scheduled-permalink-repair --selection <path> --audit <path> --output <new-directory>
  audit-publication-monitors --manifest <path> --output <new-directory>
  dry-run --blog <path> --article <path>
  save-draft --blog <path> --article <path>
  prepare-generation-package --manifest <path> --output <path>
  import-generated-articles --plan <path> --responses <path> --output <path>
  compile-generated-batch --plan <path> --responses <path> --output <path>
  attach-batch-images --manifest <path> --images <path> --output <path>
  attach-batch-sources --manifest <path> --sources <path> --output <path>
  compile-content-batch --plan <path> --responses <path> --images <path> --sources <path> --output <path>
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
  update-existing-drafts --manifest <path> --targets <path>
  update-existing-draft-images --manifest <path> --targets <path>
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
