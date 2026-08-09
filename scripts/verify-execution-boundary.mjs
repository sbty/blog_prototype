import { readFileSync } from "node:fs";

const service = readFileSync("dist/services/scheduledPostExecutionService.js", "utf8");
const browser = readFileSync("dist/browser/bloggerDryRun.js", "utf8");
const batch = readFileSync("dist/services/scheduleBatchExecutionService.js", "utf8");
const args = readFileSync("dist/cli/args.js", "utf8");

function requireText(source, text, message) {
  if (!source.includes(text)) throw new Error(message);
}

requireText(
  service,
  "getAuthorizedBloggerBlogIds(this.config)",
  "Configured blog allowlist boundary missing"
);
requireText(
  service,
  "Schedule execution requires AUTHORIZED_BLOG_IDS",
  "Missing blog allowlist must fail closed"
);
requireText(service, "ENABLE_SCHEDULED_POST", "Scheduled-post feature flag boundary missing");
requireText(service, "ENABLE_DRAFT_SAVE", "Draft-save mutual exclusion missing");
requireText(service, "calculateArtifactSha256(packageBytes)", "Package hash verification missing");
requireText(service, "calculateArtifactSha256(auditBytes)", "Audit hash verification missing");
requireText(
  service,
  "schedule-execution-attempt.json",
  "Exclusive execution-attempt marker missing"
);
requireText(service, "schedule-execution-resume.json", "Bounded execution-resume marker missing");
requireText(service, "fetchAndValidateBloggerTimezone", "Blogger timezone validation missing");
requireText(args, '"execute-schedule"', "Execution CLI contract missing");

const scheduleStart = browser.indexOf("async schedulePost");
const imageUpload = browser.indexOf("new BloggerImageUploader", scheduleStart);
const publishClick = browser.indexOf("publish.click()", scheduleStart);
if (scheduleStart < 0 || imageUpload < scheduleStart || publishClick < imageUpload) {
  throw new Error("Scheduled execution must upload the image before publish confirmation");
}

const batchPreflight = batch.indexOf("await this.validateExecutionBatch(manifest.items)");
const batchArtifact = batch.indexOf('makeJobId("schedule-batch")');
if (batchPreflight < 0 || batchArtifact < batchPreflight) {
  throw new Error("All execution items must pass preflight before batch artifact creation");
}

const executeStart = service.indexOf("async execute(input)");
const executeEnd = service.indexOf("async readOptionalArtifact", executeStart);
const executeSource = service.slice(executeStart, executeEnd);
const validationCall = executeSource.indexOf("await this.validateExecution(input)");
const attemptMarker = executeSource.indexOf("schedule-execution-attempt.json");
const validationStart = service.indexOf("async validateExecution(input)");
const validationSource = service.slice(validationStart);
const timezoneCall = validationSource.indexOf("await fetchAndValidateBloggerTimezone");
if (
  executeStart < 0 ||
  executeEnd < 0 ||
  validationCall < 0 ||
  attemptMarker < validationCall ||
  validationStart < 0 ||
  timezoneCall < 0
) {
  throw new Error("Blogger timezone validation must run before the execution-attempt marker");
}
console.log("Built scheduled-execution safety boundary checks passed.");
