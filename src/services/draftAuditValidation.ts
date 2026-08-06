import type { DraftAuditResult } from "../browser/bloggerDryRun.js";

export function assertNoDuplicateDrafts(audit: DraftAuditResult): DraftAuditResult {
  const uniqueUrls = new Set(audit.editUrls);
  if (audit.count !== audit.editUrls.length || uniqueUrls.size !== audit.editUrls.length) {
    throw new Error(`Draft audit returned inconsistent results for title "${audit.title}"`);
  }
  if (audit.count > 1) {
    throw new Error(
      `Duplicate Blogger drafts detected for title "${audit.title}": ${audit.editUrls.join(", ")}`
    );
  }
  return audit;
}