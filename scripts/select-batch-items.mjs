import { readFile, writeFile } from "node:fs/promises";

const [sourcePath, outputPath, ...slugs] = process.argv.slice(2);
if (!sourcePath || !outputPath || slugs.length === 0) {
  throw new Error("Usage: node scripts/select-batch-items.mjs <source> <output> <slug...>");
}

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const requested = new Set(slugs);
if (requested.size !== slugs.length) throw new Error("Duplicate slugs are not allowed");
const items = source.items.filter((item) => requested.has(item.article.slug));
if (items.length !== requested.size) {
  const found = new Set(items.map((item) => item.article.slug));
  throw new Error(`Unknown slug: ${slugs.find((slug) => !found.has(slug))}`);
}
const blogKeys = new Set(items.map((item) => item.blogKey));
const manifest = {
  ...source,
  continueOnError: true,
  blogs: source.blogs.filter((blog) => blogKeys.has(blog.blogKey)),
  items
};
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx"
});
console.log(
  JSON.stringify({
    outputPath,
    itemCount: items.length,
    slugs: items.map((item) => item.article.slug)
  })
);
