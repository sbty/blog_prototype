import path from "node:path";
import type { AppConfig } from "../config/env.js";
import { getAuthorizedBloggerBlogIds } from "../config/env.js";
import { batchManifestSchema } from "../domain/batch.js";
import {
  BloggerDraftSourceUpdater,
  type DraftSourceUpdateItemResult,
  type DraftSourceUpdateTarget
} from "../browser/bloggerDraftSources.js";
import { extractBloggerBlogId } from "../browser/bloggerEditorIdentity.js";
import type { BloggerSelectors } from "../browser/bloggerSelectors.js";
import { assertNotStopped } from "../system/stop.js";
import { createArtifactDir, makeJobId, writeJsonArtifactAtomic } from "./artifacts.js";

export interface DraftSourceUpdateResult {
  jobId: string;
  artifactDir: string;
  reportPath: string;
  completedAt: string;
  counts: { total: number; saved: number; alreadyPresent: number };
  items: DraftSourceUpdateItemResult[];
}

type Updater = Pick<BloggerDraftSourceUpdater, "execute">;

function sourceSection(html: string): string {
  const matches = html.match(
    /<section\b[^>]*class=["']official-sources["'][^>]*>[\s\S]*?<\/section>/gi
  );
  if (!matches || matches.length !== 1) {
    throw new Error("Each article must contain exactly one official-sources section");
  }
  return matches[0];
}

export class DraftSourceUpdateService {
  constructor(
    private readonly config: AppConfig,
    private readonly selectors: BloggerSelectors,
    private readonly updater?: Updater
  ) {}

  async execute(input: unknown): Promise<DraftSourceUpdateResult> {
    const manifest = batchManifestSchema.parse(input);
    if (manifest.operation !== "save-drafts") {
      throw new Error("Draft source update requires a save-drafts batch");
    }
    if (!this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Draft source update requires ENABLE_DRAFT_SAVE=true and ENABLE_SCHEDULED_POST=false"
      );
    }
    await assertNotStopped(this.config.DATA_DIR);
    const authorized = getAuthorizedBloggerBlogIds(this.config);
    const blogs = new Map(manifest.blogs.map((blog) => [blog.blogKey, blog]));
    const perBlog = new Set<string>();
    const targets: DraftSourceUpdateTarget[] = manifest.items.map((item) => {
      const blog = blogs.get(item.blogKey)!;
      if (perBlog.has(item.blogKey)) {
        throw new Error(`Draft source update supports one existing post per blog: ${item.blogKey}`);
      }
      perBlog.add(item.blogKey);
      if (!item.provenance) {
        throw new Error(
          `Draft source update requires provenance: ${item.blogKey}/${item.article.slug}`
        );
      }
      const postEditorUrl = blog.blogger.postEditorUrl;
      const blogId = extractBloggerBlogId(postEditorUrl);
      if (!postEditorUrl || !blogId || !authorized.has(blogId)) {
        throw new Error(`Draft source update target is not authorized: ${item.blogKey}`);
      }
      return {
        blogKey: item.blogKey,
        slug: item.article.slug,
        title: item.article.title,
        adminUrl: blog.adminUrl,
        postEditorUrl,
        sourceSectionHtml: sourceSection(item.article.html),
        sourceUrls: item.provenance.sourceUrls
      };
    });

    const jobId = makeJobId("draft-source-update");
    const artifactDir = await createArtifactDir(this.config.DATA_DIR, jobId);
    const reportPath = path.join(artifactDir, "draft-source-update.json");
    const updater = this.updater ?? new BloggerDraftSourceUpdater(this.config, this.selectors);
    const items = await updater.execute(targets, artifactDir, () =>
      assertNotStopped(this.config.DATA_DIR)
    );
    const result: DraftSourceUpdateResult = {
      jobId,
      artifactDir,
      reportPath,
      completedAt: new Date().toISOString(),
      counts: {
        total: items.length,
        saved: items.filter((item) => item.status === "SAVED").length,
        alreadyPresent: items.filter((item) => item.status === "ALREADY_PRESENT").length
      },
      items
    };
    await writeJsonArtifactAtomic(reportPath, result);
    return result;
  }
}
