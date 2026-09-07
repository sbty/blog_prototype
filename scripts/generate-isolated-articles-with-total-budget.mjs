import { open, readFile, writeFile } from "node:fs/promises";
import { OpenAIArticleGenerationService } from "../dist/services/openAIArticleGenerationService.js";
import { loadConfig } from "../dist/config/env.js";

const [indexPath, maximumCostCentsText] = process.argv.slice(2);
if (!indexPath || !/^[1-9]\d*$/.test(maximumCostCentsText ?? "")) {
  throw new Error(
    "Usage: node scripts/generate-isolated-articles-with-total-budget.mjs <index> <maximum-cost-cents>"
  );
}
const maximumCostCents = Number(maximumCostCentsText);
const index = JSON.parse(await readFile(indexPath, "utf8"));
if (!Array.isArray(index.outputs) || index.outputs.length === 0) {
  throw new Error("Isolated generation index must contain outputs");
}

const config = loadConfig(process.env);
const service = new OpenAIArticleGenerationService(config);
const existingCosts = [];
const pending = [];
for (const output of index.outputs) {
  try {
    const usage = JSON.parse(await readFile(`${output.responsePath}.usage.json`, "utf8"));
    const cost = usage?.usage?.usageBasedCostCents;
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
      throw new Error(`Invalid usage cost: ${output.responsePath}`);
    }
    existingCosts.push(cost);
    continue;
  } catch (error) {
    if ((error?.code ?? "") !== "ENOENT") throw error;
  }
  const packageInput = JSON.parse(await readFile(output.packagePath, "utf8"));
  const preflight = service.estimate(packageInput);
  pending.push({ output, packageInput, preflight });
}

const alreadySpentCents = existingCosts.reduce((total, value) => total + value, 0);
const maximumPossibleCents = pending.reduce(
  (total, item) => total + item.preflight.estimate.maximumCostCents,
  alreadySpentCents
);
if (maximumPossibleCents > maximumCostCents) {
  throw new Error(
    `Raw API cost ceiling ${maximumPossibleCents.toFixed(4)} cents exceeds total budget ${maximumCostCents} cents`
  );
}

let actualCostCents = alreadySpentCents;
const results = [];
for (const item of pending) {
  const outputHandle = await open(item.output.responsePath, "wx");
  try {
    await writeFile(
      `${item.output.responsePath}.attempt.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          estimate: item.preflight.estimate,
          totalBudgetCents: maximumCostCents,
          maximumPossibleCents
        },
        null,
        2
      )}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    const result = await service.execute(
      item.packageInput,
      item.preflight.estimate.maximumCostCents
    );
    await outputHandle.writeFile(`${JSON.stringify(result.responses, null, 2)}\n`, "utf8");
    const itemCostCents = result.usage?.usageBasedCostCents ?? 0;
    actualCostCents += itemCostCents;
    await writeFile(
      `${item.output.responsePath}.usage.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          responseId: result.responseId,
          estimate: result.estimate,
          usage: result.usage,
          cumulativeUsageBasedCostCents: actualCostCents,
          totalBudgetCents: maximumCostCents
        },
        null,
        2
      )}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    if (actualCostCents > maximumCostCents) {
      throw new Error(`Actual API cost ${actualCostCents.toFixed(4)} cents exceeded total budget`);
    }
    results.push({ slug: item.output.slug, status: "GENERATED", itemCostCents, actualCostCents });
  } finally {
    await outputHandle.close();
  }
}

console.log(
  JSON.stringify(
    {
      totalBudgetCents: maximumCostCents,
      maximumPossibleCents,
      actualCostCents,
      alreadyGenerated: existingCosts.length,
      generatedNow: results.length,
      results
    },
    null,
    2
  )
);
