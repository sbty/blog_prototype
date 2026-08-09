import { validateImageFile } from "../browser/imageFile.js";
import { loadBloggerSelectors } from "../browser/bloggerSelectors.js";
import { prepareSchedulePreview } from "../browser/bloggerSchedulePreview.js";
import { getAuthorizedBloggerBlogIds, type AppConfig } from "../config/env.js";
import { scheduleCampaignManifestSchema } from "../domain/scheduleCampaign.js";
import type { ArticleRepository } from "../repositories/articleRepository.js";

export interface CampaignPreflightIssue {
  code: string;
  path: string;
  message: string;
}

export interface ScheduleCampaignPreflightResult {
  checkedAt: string;
  passed: boolean;
  counts: { blogs: number; items: number; images: number };
  issues: CampaignPreflightIssue[];
  warnings: CampaignPreflightIssue[];
}

export class ScheduleCampaignPreflightService {
  constructor(
    private readonly config: AppConfig,
    private readonly articles: Pick<ArticleRepository, "countSchedulePlansForLocalDate">,
    private readonly dependencies: {
      validateImage: (imagePath: string) => Promise<unknown>;
      validateSelectors: (selectorsPath: string) => Promise<unknown>;
    } = {
      validateImage: validateImageFile,
      validateSelectors: (selectorsPath) => loadBloggerSelectors(selectorsPath)
    },
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: unknown): Promise<ScheduleCampaignPreflightResult> {
    const parsed = scheduleCampaignManifestSchema.safeParse(input);
    const issues: CampaignPreflightIssue[] = [];
    const warnings: CampaignPreflightIssue[] = [];
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          code: "MANIFEST_INVALID",
          path: issue.path.join("."),
          message: issue.message
        });
      }
      return this.result(0, 0, 0, issues, warnings);
    }
    const manifest = parsed.data;
    this.validateFlags(issues);
    const blogs = new Map(manifest.blogs.map((blog) => [blog.blogKey, blog]));
    const authorizedBlogIds = getAuthorizedBloggerBlogIds(this.config);

    for (let index = 0; index < manifest.blogs.length; index += 1) {
      const blog = manifest.blogs[index];
      if (!blog.publicUrl) {
        issues.push({
          code: "PUBLIC_URL_REQUIRED",
          path: `blogs.${index}.publicUrl`,
          message: `Scheduled execution requires publicUrl for ${blog.blogKey}`
        });
      }
      try {
        await this.dependencies.validateSelectors(blog.blogger.selectorsPath);
      } catch (error) {
        issues.push({
          code: "SELECTORS_INVALID",
          path: `blogs.${index}.blogger.selectorsPath`,
          message: error instanceof Error ? error.message : String(error)
        });
      }
      const blogId = new URL(blog.adminUrl).pathname.match(/^\/blog\/posts\/(\d+)\/?$/)?.[1];
      if (!blogId || !authorizedBlogIds.has(blogId)) {
        warnings.push({
          code: "BLOG_NOT_AUTHORIZED",
          path: `blogs.${index}.adminUrl`,
          message: `Final execution is not currently authorized for ${blog.blogKey}`
        });
      }
    }

    const systemIncoming = new Map<string, number>();
    const blogIncoming = new Map<string, number>();
    const existingSystem = new Map<string, number>();
    const existingBlog = new Map<string, number>();
    const scheduleSlots = new Set<string>();
    const imagePaths = new Map<string, number[]>();

    for (let index = 0; index < manifest.items.length; index += 1) {
      const item = manifest.items[index];
      let preview;
      try {
        preview = prepareSchedulePreview(
          item.article.scheduledAt!,
          this.config.APP_TIMEZONE,
          this.now()
        );
      } catch (error) {
        issues.push({
          code: "SCHEDULE_TIME_INVALID",
          path: `items.${index}.article.scheduledAt`,
          message: error instanceof Error ? error.message : String(error)
        });
        continue;
      }
      const slot = `${item.blogKey}\0${preview.scheduledAt}`;
      if (scheduleSlots.has(slot)) {
        issues.push({
          code: "DUPLICATE_SCHEDULE_SLOT",
          path: `items.${index}.article.scheduledAt`,
          message: `Duplicate schedule time for ${item.blogKey}: ${preview.scheduledAt}`
        });
      }
      scheduleSlots.add(slot);
      if (!item.resumeJobId) {
        const localDate = preview.date.replaceAll("/", "-");
        const blogKey = `${item.blogKey}\0${localDate}`;
        if (!existingSystem.has(localDate)) {
          existingSystem.set(
            localDate,
            this.articles.countSchedulePlansForLocalDate({
              localDate,
              timezone: this.config.APP_TIMEZONE
            })
          );
        }
        if (!existingBlog.has(blogKey)) {
          existingBlog.set(
            blogKey,
            this.articles.countSchedulePlansForLocalDate({
              localDate,
              timezone: this.config.APP_TIMEZONE,
              blogKey: item.blogKey
            })
          );
        }
        const nextSystem = (systemIncoming.get(localDate) ?? 0) + 1;
        const nextBlog = (blogIncoming.get(blogKey) ?? 0) + 1;
        systemIncoming.set(localDate, nextSystem);
        blogIncoming.set(blogKey, nextBlog);
        if (
          (existingSystem.get(localDate) ?? 0) + nextSystem >
          this.config.SYSTEM_DAILY_POST_LIMIT
        ) {
          issues.push({
            code: "SYSTEM_DAILY_LIMIT_EXCEEDED",
            path: `items.${index}.article.scheduledAt`,
            message: `Campaign exceeds the system daily limit for ${localDate}`
          });
        }
        const blog = blogs.get(item.blogKey)!;
        const blogLimit = Math.min(this.config.PER_BLOG_DAILY_POST_LIMIT, blog.dailyPostLimit);
        if ((existingBlog.get(blogKey) ?? 0) + nextBlog > blogLimit) {
          issues.push({
            code: "BLOG_DAILY_LIMIT_EXCEEDED",
            path: `items.${index}.article.scheduledAt`,
            message: `Campaign exceeds the daily limit for ${item.blogKey} on ${localDate}`
          });
        }
      }
      if (item.article.imagePath) {
        const indexes = imagePaths.get(item.article.imagePath) ?? [];
        indexes.push(index);
        imagePaths.set(item.article.imagePath, indexes);
      }
    }

    for (const [imagePath, indexes] of imagePaths) {
      try {
        await this.dependencies.validateImage(imagePath);
      } catch (error) {
        for (const index of indexes) {
          issues.push({
            code: "IMAGE_INVALID",
            path: `items.${index}.article.imagePath`,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
    return this.result(
      manifest.blogs.length,
      manifest.items.length,
      imagePaths.size,
      issues,
      warnings
    );
  }

  private validateFlags(issues: CampaignPreflightIssue[]): void {
    if (!this.config.ENABLE_DRY_RUN) {
      issues.push({
        code: "DRY_RUN_DISABLED",
        path: "environment.ENABLE_DRY_RUN",
        message: "Campaign preparation requires ENABLE_DRY_RUN=true"
      });
    }
    if (this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      issues.push({
        code: "MUTATION_FLAGS_ENABLED",
        path: "environment",
        message: "Campaign preparation requires draft save and scheduled post to be disabled"
      });
    }
  }

  private result(
    blogs: number,
    items: number,
    images: number,
    issues: CampaignPreflightIssue[],
    warnings: CampaignPreflightIssue[]
  ): ScheduleCampaignPreflightResult {
    return {
      checkedAt: this.now().toISOString(),
      passed: issues.length === 0,
      counts: { blogs, items, images },
      issues,
      warnings
    };
  }
}
