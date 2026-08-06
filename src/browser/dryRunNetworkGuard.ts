import type { Page } from "@playwright/test";

const MAX_RECORDED_REQUESTS = 100;

export interface DryRunNetworkGuardResult {
  blockedMutationRequests: number;
  blockedRequests: Array<{ method: string; url: string }>;
  blockedRequestLogTruncated: boolean;
}

export function isPotentialMutationRequest(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

export function sanitizeRequestUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return `${url.origin}${url.pathname}`;
    }
    return `${url.protocol}//[redacted]`;
  } catch {
    return "[invalid-url]";
  }
}

export async function installDryRunNetworkGuard(page: Page): Promise<{
  snapshot: () => DryRunNetworkGuardResult;
}> {
  let blockedMutationRequests = 0;
  const blockedRequests: Array<{ method: string; url: string }> = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (isPotentialMutationRequest(request.method())) {
      blockedMutationRequests += 1;
      if (blockedRequests.length < MAX_RECORDED_REQUESTS) {
        blockedRequests.push({
          method: request.method().toUpperCase(),
          url: sanitizeRequestUrl(request.url())
        });
      }
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return {
    snapshot: () => ({
      blockedMutationRequests,
      blockedRequests: [...blockedRequests],
      blockedRequestLogTruncated: blockedMutationRequests > blockedRequests.length
    })
  };
}