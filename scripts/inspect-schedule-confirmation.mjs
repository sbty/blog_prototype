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
import { parseJsonWithBom } from "../dist/utils/json.js";

const config = loadConfig();
const blog = blogConfigSchema.parse(
  parseJsonWithBom(await readFile(resolve("examples/blog.example.json"), "utf8"))
);
const article = articleInputSchema.parse(
  parseJsonWithBom(
    await readFile(resolve("data/phase6-confirmation-acceptance-article.json"), "utf8")
  )
);
const artifactDir = await createArtifactDir(
  config.DATA_DIR,
  makeJobId("schedule-confirmation-inspection")
);
const result = await new BloggerDryRunClient(
  config,
  await loadBloggerSelectors(blog.blogger.selectorsPath)
).inspectScheduleConfirmation({
  adminUrl: blog.adminUrl,
  article,
  artifactDir
});
await writeJsonArtifactExclusive(
  resolve(artifactDir, "schedule-confirmation-inspection.json"),
  result
);
console.log(JSON.stringify({ artifactDir, result }));
