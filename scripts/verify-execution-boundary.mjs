import { readFileSync } from "node:fs";

const service = readFileSync("dist/services/scheduledPostExecutionService.js", "utf8");
const browser = readFileSync("dist/browser/bloggerDryRun.js", "utf8");
const args = readFileSync("dist/cli/args.js", "utf8");

function requireText(source, text, message) {
  if (!source.includes(text)) throw new Error(message);
}

requireText(
  service,
  "this.config.AUTHORIZED_TEST_BLOG_ID",
  "Configured dedicated test blog boundary missing"
);
requireText(
  service,
  "Schedule execution requires AUTHORIZED_TEST_BLOG_ID",
  "Missing dedicated test blog must fail closed"
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

const timezoneCall = service.indexOf("await fetchAndValidateBloggerTimezone");
const attemptMarker = service.indexOf("schedule-execution-attempt.json");
if (timezoneCall < 0 || attemptMarker < timezoneCall) {
  throw new Error("Blogger timezone validation must run before the execution-attempt marker");
}
console.log("Built scheduled-execution safety boundary checks passed.");
