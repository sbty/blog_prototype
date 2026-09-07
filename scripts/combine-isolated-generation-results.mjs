import { readFile, writeFile } from "node:fs/promises";

const [indexPath, planOutputPath, responsesOutputPath] = process.argv.slice(2);
if (!indexPath || !planOutputPath || !responsesOutputPath) {
  throw new Error(
    "Usage: node scripts/combine-isolated-generation-results.mjs <index> <plan-output> <responses-output>"
  );
}

const index = JSON.parse(await readFile(indexPath, "utf8"));
if (!Array.isArray(index.outputs) || index.outputs.length === 0) {
  throw new Error("Isolated generation index must contain outputs");
}
const plans = await Promise.all(
  index.outputs.map(async (output) => JSON.parse(await readFile(output.planPath, "utf8")))
);
const responseDocuments = await Promise.all(
  index.outputs.map(async (output) => JSON.parse(await readFile(output.responsePath, "utf8")))
);
const blogs = plans.map((plan) => plan.blogs[0]);
const requests = plans.map((plan) => plan.requests[0]);
const items = responseDocuments.map((document) => document.items?.[0]);
if (
  blogs.some((blog) => !blog) ||
  requests.some((request) => !request) ||
  items.some((item) => !item)
) {
  throw new Error("Each isolated output must contain exactly one blog, request, and response item");
}
if (new Set(requests.map((request) => request.requestId)).size !== requests.length) {
  throw new Error("Combined plan contains duplicate request IDs");
}
if (new Set(items.map((item) => item.requestId)).size !== items.length) {
  throw new Error("Combined responses contain duplicate request IDs");
}
const combinedPlan = { targetOperation: "save-drafts", continueOnError: false, blogs, requests };
const combinedResponses = { schemaVersion: 1, items };
await Promise.all([
  writeFile(planOutputPath, `${JSON.stringify(combinedPlan, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  }),
  writeFile(responsesOutputPath, `${JSON.stringify(combinedResponses, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  })
]);
console.log(JSON.stringify({ planOutputPath, responsesOutputPath, itemCount: items.length }));
