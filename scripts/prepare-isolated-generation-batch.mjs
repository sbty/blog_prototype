import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArticleGenerationPackageService } from "../dist/services/articleGenerationPackageService.js";

const [targetsPath, sourcePlanPath, outputPrefix] = process.argv.slice(2);
if (!targetsPath || !sourcePlanPath || !outputPrefix) {
  throw new Error(
    "Usage: node scripts/prepare-isolated-generation-batch.mjs <targets> <source-plan> <output-prefix>"
  );
}

const [targetsInput, sourcePlan] = await Promise.all(
  [targetsPath, sourcePlanPath].map(async (file) => JSON.parse(await readFile(file, "utf8")))
);
if (!Array.isArray(targetsInput.targets) || !Array.isArray(sourcePlan.blogs)) {
  throw new Error("Targets and source plan must contain targets and blogs arrays");
}

const service = new ArticleGenerationPackageService();
const outputs = [];
for (const [index, target] of targetsInput.targets.entries()) {
  const sourceUrls = target.officialSourceCandidates.map((source) => source.url);
  const sourceRequirements = target.officialSourceCandidates.map(
    (source) =>
      `${source.publisher}の公式情報「${source.title}」の対象範囲に限定し、本文中でこのURLを読者向けにリンクする。`
  );
  const plan = {
    targetOperation: "dry-run",
    continueOnError: false,
    blogs: sourcePlan.blogs.filter((blog) => blog.blogKey === target.blogKey),
    requests: [
      {
        requestId: target.requestId,
        blogKey: target.blogKey,
        slug: target.slug,
        topic: target.title,
        searchIntent: target.searchIntent,
        routingTopics: target.topicClusters,
        requiredPoints: [
          `記事は「${target.title}」の検索意図だけを扱う。対象外の一般論、他記事の例、他ジャンルの見出しや段落を追加しない。`,
          ...target.requiredPoints,
          ...sourceRequirements,
          "本文量を増やすための定型文、汎用チェックリスト、他ジャンルに共通する追記を加えない。",
          "結論では、このテーマで確認できた条件と、型番・製品版・地域・時点により公式情報で確認すべき条件だけを整理する。"
        ],
        sourceUrls
      }
    ]
  };
  const { package: generationPackage } = service.execute(plan);
  const number = String(index + 1).padStart(2, "0");
  const basePath = `${outputPrefix}-${number}-${target.slug}`;
  const planPath = `${basePath}.plan.json`;
  const packagePath = `${basePath}.generation-package.json`;
  await Promise.all(
    [
      [planPath, plan],
      [packagePath, generationPackage]
    ].map(async ([file, value]) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
    })
  );
  outputs.push({
    requestId: target.requestId,
    slug: target.slug,
    planPath,
    packagePath,
    responsePath: `${basePath}.responses.json`
  });
}

const indexPath = `${outputPrefix}-isolated-plan-index.json`;
await writeFile(
  indexPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      batchName: targetsInput.batchName,
      generationMode: "one-openai-request-per-article",
      costLimitCents: 12,
      outputs
    },
    null,
    2
  )}\n`,
  { encoding: "utf8", flag: "wx" }
);
console.log(indexPath);
