import { realpath } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { BloggerDryRunClient, type ScheduledPostResult } from "../browser/bloggerDryRun.js";
import { loadBloggerSelectors } from "../browser/bloggerSelectors.js";
import type { AppConfig } from "../config/env.js";
import { articleInputSchema } from "../domain/article.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { JobRepository } from "../repositories/jobRepository.js";
import { assertNotStopped } from "../system/stop.js";
import { parseJsonWithBom } from "../utils/json.js";
import { readArtifactFileInsideDirectory, writeJsonArtifactExclusive } from "./artifacts.js";
import { calculateArtifactSha256 } from "./scheduleApprovalIntegrity.js";
import { fetchAndValidateBloggerTimezone } from "./bloggerTimezoneValidation.js";
import {
  scheduleExecutionPackageArtifactSchema,
  scheduleExecutionPackageAuditArtifactSchema,
  schedulePlanArtifactSchema
} from "./scheduleArtifactValidation.js";

export class ScheduledPostExecutionService {
  constructor(
    private readonly config: AppConfig,
    private readonly repos: { jobs: JobRepository; blogs: BlogRepository },
    private readonly logger: Logger
  ) {}

  async execute(input: {
    jobId: string;
    confirmation: string;
    packageSha256: string;
    auditSha256: string;
  }): Promise<ScheduledPostResult> {
    if (!this.config.ENABLE_SCHEDULED_POST || this.config.ENABLE_DRAFT_SAVE) {
      throw new Error(
        "Schedule execution requires ENABLE_SCHEDULED_POST=true and ENABLE_DRAFT_SAVE=false"
      );
    }
    if (input.confirmation !== input.jobId)
      throw new Error("Execution confirmation must match job ID");
    await assertNotStopped(this.config.DATA_DIR);
    const job = this.repos.jobs.find(input.jobId);
    if (!job || job.mode !== "schedule" || job.status !== "PREVIEW_CONFIRMED") {
      throw new Error("Schedule job must be PREVIEW_CONFIRMED");
    }
    const blog = this.repos.blogs.findConfig(job.blogKey);
    if (!blog) throw new Error("Schedule blog configuration was not found");
    if (!this.config.AUTHORIZED_TEST_BLOG_ID) {
      throw new Error("Schedule execution requires AUTHORIZED_TEST_BLOG_ID");
    }
    const blogId = new URL(blog.adminUrl).pathname.match(/^\/blog\/posts\/(\d+)\/?$/)?.[1];
    if (blogId !== this.config.AUTHORIZED_TEST_BLOG_ID)
      throw new Error("Schedule execution is restricted to the dedicated test blog");
    const artifactDir = await realpath(job.artifactDir);
    const [planBytes, packageBytes, auditBytes] = await Promise.all([
      readArtifactFileInsideDirectory(artifactDir, "schedule-plan.json"),
      readArtifactFileInsideDirectory(artifactDir, "schedule-execution-package.json"),
      readArtifactFileInsideDirectory(artifactDir, "schedule-execution-package-audit.json")
    ]);
    if (
      calculateArtifactSha256(packageBytes) !== input.packageSha256 ||
      calculateArtifactSha256(auditBytes) !== input.auditSha256
    ) {
      throw new Error("Execution evidence SHA-256 does not match");
    }
    const plan = schedulePlanArtifactSchema.parse(
      parseJsonWithBom(Buffer.from(planBytes).toString("utf8"))
    );
    const executionPackage = scheduleExecutionPackageArtifactSchema.parse(
      parseJsonWithBom(Buffer.from(packageBytes).toString("utf8"))
    );
    const audit = scheduleExecutionPackageAuditArtifactSchema.parse(
      parseJsonWithBom(Buffer.from(auditBytes).toString("utf8"))
    );
    if (
      executionPackage.jobId !== input.jobId ||
      audit.jobId !== input.jobId ||
      audit.packageSha256 !== input.packageSha256
    ) {
      throw new Error("Execution evidence chain does not match the job");
    }
    const article = articleInputSchema.parse(JSON.parse(job.payloadJson));
    if (Date.parse(article.scheduledAt ?? "") !== Date.parse(plan.scheduledAt))
      throw new Error("Scheduled article does not match approved plan");
    if (Date.parse(plan.scheduledAt) <= Date.now() + 10 * 60 * 1000)
      throw new Error("Scheduled time must remain at least 10 minutes in the future");
    if (!blog.publicUrl) throw new Error("Schedule execution requires a Blogger public URL");
    const timezoneEvidence = await fetchAndValidateBloggerTimezone({
      publicUrl: blog.publicUrl,
      expectedTimezone: this.config.APP_TIMEZONE
    });
    const attempt = {
      artifactType: "schedule-execution-attempt",
      schemaVersion: 1,
      jobId: input.jobId,
      startedAt: new Date().toISOString(),
      authorizedBlogId: this.config.AUTHORIZED_TEST_BLOG_ID,
      packageSha256: input.packageSha256,
      auditSha256: input.auditSha256,
      timezoneEvidence
    };
    try {
      await writeJsonArtifactExclusive(
        path.join(artifactDir, "schedule-execution-attempt.json"),
        attempt
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        await readArtifactFileInsideDirectory(artifactDir, "schedule-execution-result.json");
        throw new Error("Schedule execution already completed");
      } catch (resultError) {
        if ((resultError as Error).message === "Schedule execution already completed")
          throw resultError;
      }
      const priorAttempt = parseJsonWithBom<Record<string, unknown>>(
        Buffer.from(
          await readArtifactFileInsideDirectory(artifactDir, "schedule-execution-attempt.json")
        ).toString("utf8")
      );
      if (
        priorAttempt.jobId !== attempt.jobId ||
        priorAttempt.packageSha256 !== attempt.packageSha256 ||
        priorAttempt.auditSha256 !== attempt.auditSha256
      )
        throw new Error("Schedule execution attempt evidence does not match");
      await writeJsonArtifactExclusive(path.join(artifactDir, "schedule-execution-resume.json"), {
        ...attempt,
        resumedAt: new Date().toISOString()
      });
    }
    const assertCanMutate = async () => {
      await assertNotStopped(this.config.DATA_DIR);
      if (!this.config.ENABLE_SCHEDULED_POST || this.config.ENABLE_DRAFT_SAVE)
        throw new Error("Schedule execution flags changed");
    };
    const result = await new BloggerDryRunClient(
      this.config,
      await loadBloggerSelectors(blog.blogger.selectorsPath)
    ).schedulePost({
      adminUrl: blog.adminUrl,
      postEditorUrl: blog.blogger.postEditorUrl,
      article,
      artifactDir,
      assertCanMutate
    });
    await writeJsonArtifactExclusive(
      path.join(artifactDir, "schedule-execution-result.json"),
      result
    );
    this.repos.jobs.addEvent(
      input.jobId,
      "BLOGGER_SCHEDULE_CONFIRMED",
      "One dedicated-test-blog post was scheduled",
      result
    );
    this.logger.info(
      { jobId: input.jobId, scheduledAt: result.scheduledAt },
      "Blogger schedule confirmed"
    );
    return result;
  }
}
