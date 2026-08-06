import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BloggerDryRunClient } from "../dist/browser/bloggerDryRun.js";
import { loadBloggerSelectors } from "../dist/browser/bloggerSelectors.js";
import { blogConfigSchema } from "../dist/config/blogConfig.js";
import { loadConfig } from "../dist/config/env.js";
import { articleInputSchema } from "../dist/domain/article.js";
import {
  createArtifactDir,
  makeJobId,
  writeJsonArtifactExclusive
} from "../dist/services/artifacts.js";
import { assertNotStopped } from "../dist/system/stop.js";
import { parseJsonWithBom } from "../dist/utils/json.js";

const config = loadConfig();
if (!config.ENABLE_DRAFT_SAVE || config.ENABLE_SCHEDULED_POST)
  throw new Error("Unsafe repair flags");
if (!config.AUTHORIZED_TEST_BLOG_ID) throw new Error("Repair requires AUTHORIZED_TEST_BLOG_ID");

const blogConfigPath = process.env.AUTHORIZED_REPAIR_BLOG_CONFIG_PATH?.trim();
const articlePath = process.env.AUTHORIZED_REPAIR_ARTICLE_PATH?.trim();
const postId = process.env.AUTHORIZED_REPAIR_POST_ID?.trim();
if (!blogConfigPath || !articlePath || !postId || !/^\d{10,30}$/.test(postId)) {
  throw new Error(
    "Repair requires AUTHORIZED_REPAIR_BLOG_CONFIG_PATH, AUTHORIZED_REPAIR_ARTICLE_PATH, and a numeric AUTHORIZED_REPAIR_POST_ID"
  );
}

const blog = blogConfigSchema.parse(
  parseJsonWithBom(await readFile(resolve(blogConfigPath), "utf8"))
);
const article = articleInputSchema.parse(
  parseJsonWithBom(await readFile(resolve(articlePath), "utf8"))
);
if (!article.imagePath) throw new Error("Repair article has no imagePath");
const blogId = new URL(blog.adminUrl).pathname.match(/^\/blog\/posts\/(\d+)\/?$/)?.[1];
if (blogId !== config.AUTHORIZED_TEST_BLOG_ID) throw new Error("Unauthorized repair blog");
const authorizedUrl = `https://www.blogger.com/blog/post/edit/${config.AUTHORIZED_TEST_BLOG_ID}/${postId}`;

await assertNotStopped(config.DATA_DIR);
const artifactDir = await createArtifactDir(config.DATA_DIR, makeJobId("scheduled-image-repair"));
const result = await new BloggerDryRunClient(
  config,
  await loadBloggerSelectors(blog.blogger.selectorsPath)
).updateScheduledPostImage({
  adminUrl: blog.adminUrl,
  postEditorUrl: authorizedUrl,
  article,
  artifactDir,
  assertCanMutate: () => assertNotStopped(config.DATA_DIR)
});
await writeJsonArtifactExclusive(resolve(artifactDir, "scheduled-image-repair.json"), result);
console.log(JSON.stringify({ artifactDir, result }));
