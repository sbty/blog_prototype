import {
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Response
} from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/env.js";
import type { ArticleInput } from "../domain/article.js";
import { evaluatePersistedDraft } from "../domain/draftPersistence.js";
import type { BloggerSelectors } from "./bloggerSelectors.js";
import { BloggerImageUploader, type ImageUploadResult } from "./bloggerImageUploader.js";
import {
  extractBloggerBlogId,
  extractBloggerPostId,
  normalizeBloggerEditUrl,
  validateBloggerEditorIdentity
} from "./bloggerEditorIdentity.js";
import { BloggerPostSettings, type PostSettingsResult } from "./bloggerPostSettings.js";
import { BloggerSchedulePreview, type SchedulePreviewValue } from "./bloggerSchedulePreview.js";
import { detectBloggerSessionIssue } from "./bloggerSessionGuard.js";
import { launchChromePersistentContext } from "./chromeContext.js";
import {
  installDryRunNetworkGuard,
  sanitizeRequestUrl,
  type DryRunNetworkGuardResult
} from "./dryRunNetworkGuard.js";

export interface DraftSaveResult {
  screenshotPath: string;
  currentUrl: string;
  savedAt: string;
  imageUpload?: ImageUploadResult;
  postSettings?: PostSettingsResult;
  schedulePreview?: SchedulePreviewValue;
}

export interface ScheduledPostResult extends DraftSaveResult {
  scheduledAt: string;
}

export interface ScheduledImageRepairResult {
  screenshotPath: string;
  currentUrl: string;
  savedAt: string;
  imageUpload: ImageUploadResult;
}

export interface ExistingDraftImageUpdateResult extends ScheduledImageRepairResult {
  preImageCount: number;
}

export interface ScheduledPermalinkRepairResult {
  screenshotPath: string;
  currentUrl: string;
  savedAt: string;
  slug: string;
  saveCompletion?: DraftSaveCompletionResult;
}

export interface DraftSaveCompletionResult {
  savedIndicatorVisibleBeforeClick: boolean;
  savedIndicatorTransitionObserved: boolean;
  saveMenuClosed: boolean;
  networkIdleObserved: boolean;
  quiescenceMs: number;
  networkTransaction?: DraftSaveNetworkTransactionEvidence;
  changeRecognition?: DraftChangeRecognitionResult;
  uiSnapshots?: {
    beforeInput: PermalinkUiSnapshot;
    afterInput: PermalinkUiSnapshot;
    beforeSaveClick: PermalinkUiSnapshot;
  };
}

export type DraftSaveNetworkTerminalStatus =
  | "SUCCESS"
  | "HTTP_ERROR"
  | "APPLICATION_ERROR"
  | "APPLICATION_UNCONFIRMED"
  | "SLUG_NOT_OBSERVED"
  | "NO_POST_CLICK_TRANSACTION"
  | "REQUEST_FAILED"
  | "NO_TRANSACTION"
  | "TIMED_OUT";

export type DraftSaveNetworkApplicationStatus = "SUCCESS" | "ERROR" | "UNKNOWN" | "NOT_APPLICABLE";

export interface DraftSaveNetworkRequestEvidence {
  ordinal: number;
  requestStartedAt: string;
  completedAt: string | null;
  elapsedMs: number | null;
  method: string;
  url: string;
  rpcIds: string[];
  startedAfterExplicitSaveClick: boolean;
  requestBodySha256: string | null;
  exactSlugPresent: boolean;
  responseStatus: number | null;
  responseBodySha256: string | null;
  applicationStatus: DraftSaveNetworkApplicationStatus;
  returnedPermalink: "EXPECTED_SLUG" | "OTHER_SLUG" | "NOT_OBSERVED";
  terminalStatus: "SUCCESS" | "HTTP_ERROR" | "REQUEST_FAILED" | "TIMED_OUT";
}

export interface DraftSaveNetworkTransactionEvidence {
  terminalStatus: DraftSaveNetworkTerminalStatus;
  actionStartedAt: string;
  completedAt: string;
  elapsedMs: number;
  explicitSaveClickStartedAt: string | null;
  postClickGraceMs: number;
  expectedSlugSha256: string;
  correlatedRequestOrdinal: number | null;
  transactions: DraftSaveNetworkRequestEvidence[];
}

export interface DraftSaveNetworkObserver {
  markExplicitSaveClick(): void;
  run<T>(
    trigger: () => Promise<T>,
    timeoutMs?: number
  ): Promise<{ value: T; evidence: DraftSaveNetworkTransactionEvidence }>;
  dispose(): void;
}

export interface DraftChangeRecognitionResult {
  savedIndicatorVisibleBeforeChange: boolean;
  savedIndicatorHiddenAfterChange: boolean;
  savedIndicatorVisibleAfterChange: boolean;
}

export interface PermalinkUiSnapshot {
  inputValue: string;
  inputInitialValue: string | null;
  customOptionChecked: string | null;
  permalinkExpanded: string | null;
  previewUrl: string | null;
  focusedAriaLabel: string | null;
  saveMenuVisible: boolean;
  savedIndicatorVisible: boolean;
}

export interface ScheduledPostDraftRecoveryResult {
  screenshotPath: string;
  currentUrl: string;
  changedAt: string;
}

export interface ScheduleConfirmationInspectionResult {
  currentUrl: string;
  dialogTexts: string[];
  visibleButtonTexts: string[];
  screenshotPath: string;
  htmlPath: string;
  networkGuard: DryRunNetworkGuardResult;
}

export interface DraftAuditResult {
  title: string;
  editUrls: string[];
  count: number;
  rowTexts?: string[];
}

export interface BloggerPostListEntry {
  postId?: string;
  editUrl: string;
  title: string;
  postState: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "UNKNOWN";
  rowText: string;
}

export interface ExistingDraftInspection {
  blogId: string;
  postId?: string;
  editUrl: string;
  postState: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "UNKNOWN";
  publishedAt?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  title: string;
  html: string;
  labels: string[];
  searchDescription: string;
  slug: string;
  imageCount: number;
}
export interface DryRunResult {
  screenshotPath: string;
  currentUrl: string;
  publishButtonVisible: boolean;
  postSettings: PostSettingsResult;
  schedulePreview?: SchedulePreviewValue;
  networkGuard: DryRunNetworkGuardResult;
}

export function requireDryRunEditorTarget(
  adminUrl: string,
  postEditorUrl: string | undefined
): asserts postEditorUrl is string {
  if (!postEditorUrl) {
    throw new Error(
      "Dry-run requires blogger.postEditorUrl for an existing dedicated draft because opening New Post creates a Blogger draft"
    );
  }
  const configuredBlogId = extractBloggerBlogId(adminUrl);
  let editorUrl: URL;
  try {
    editorUrl = new URL(postEditorUrl);
  } catch {
    throw new Error("Dry-run blogger.postEditorUrl is not a valid URL");
  }
  const editorMatch = editorUrl.pathname.match(/^\/blog\/post\/edit\/(\d+)\/(\d+)\/?$/);
  if (
    editorUrl.protocol !== "https:" ||
    !["www.blogger.com", "blogger.com"].includes(editorUrl.hostname) ||
    editorUrl.username ||
    editorUrl.password ||
    editorUrl.search ||
    editorUrl.hash ||
    !editorMatch
  ) {
    throw new Error(
      "Dry-run blogger.postEditorUrl must identify an existing Blogger draft edit URL"
    );
  }
  if (!configuredBlogId || configuredBlogId !== editorMatch[1]) {
    throw new Error("Dry-run blogger.postEditorUrl must belong to the configured blog");
  }
}

export function requireDraftMutationGuard(
  guard: (() => Promise<void>) | undefined
): asserts guard is () => Promise<void> {
  if (!guard) throw new Error("Draft save requires a mutation guard");
}

export function validateDraftTitle(actual: string, expected: string): void {
  if (actual.trim() !== expected.trim()) {
    throw new Error("Blogger draft title value mismatch");
  }
}

export async function performDraftMutationWithGuard<T>(
  assertCanMutate: (() => Promise<void>) | undefined,
  mutation: () => Promise<T>
): Promise<T> {
  await assertCanMutate?.();
  return mutation();
}

interface DraftSaveButton {
  getAttribute(name: string): Promise<string | null>;
  click(): Promise<void>;
}

interface DraftSaveMenuItem extends DraftSaveButton {
  press(key: string): Promise<void>;
}

export async function clickDraftSaveButtonWithGuard(
  button: DraftSaveButton,
  assertCanMutate?: () => Promise<void>,
  beforeClick?: () => void
): Promise<boolean> {
  if ((await button.getAttribute("aria-disabled")) === "true") return false;
  await assertCanMutate?.();
  beforeClick?.();
  await button.click();
  return true;
}

/**
 * Activates Blogger's Save menu item through its native keyboard path. The
 * permalink-only repair uses this instead of a pointer click because the live
 * menu kept open after the prior guarded click, while its Save menuitem is
 * keyboard-focusable. This is one activation, not a click-and-retry fallback.
 */
export async function pressDraftSaveMenuItemWithGuard(
  menuItem: DraftSaveMenuItem,
  assertCanMutate?: () => Promise<void>,
  beforePress?: () => void
): Promise<boolean> {
  if ((await menuItem.getAttribute("aria-disabled")) === "true") return false;
  await assertCanMutate?.();
  beforePress?.();
  await menuItem.press("Enter");
  return true;
}

function isBloggerMutationRequest(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method().toUpperCase())) return false;
  try {
    const url = new URL(request.url());
    const isBloggerHost =
      url.protocol === "https:" &&
      (url.hostname === "blogger.com" || url.hostname.endsWith(".blogger.com"));
    if (!isBloggerHost) return false;
    return (
      url.pathname === "/_/BloggerUi/data/batchexecute" ||
      /^\/blog\/post\/edit\/\d+\/\d+\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

interface TrackedDraftSaveRequest {
  request: Request;
  ordinal: number;
  requestStartedAtMs: number;
  method: string;
  url: string;
  rpcIds: string[];
  startedAfterExplicitSaveClick: boolean;
  requestBodySha256: string | null;
  exactSlugPresent: boolean;
  completedAtMs: number | null;
  responseStatus: number | null;
  responseBodySha256: string | null;
  applicationStatus: DraftSaveNetworkApplicationStatus;
  returnedPermalink: DraftSaveNetworkRequestEvidence["returnedPermalink"];
  terminalStatus: DraftSaveNetworkRequestEvidence["terminalStatus"] | null;
}

const BLOGGER_PERMALINK_PREVIEW_RPC_ID = "L3WS8";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodedRequestData(body: string): string[] {
  const values = [body];
  try {
    values.push(decodeURIComponent(body.replaceAll("+", " ")));
  } catch {
    // Malformed encoding is hashed but never retained.
  }
  try {
    const form = new URLSearchParams(body);
    for (const value of form.values()) values.push(value);
  } catch {
    // Non-form request bodies are handled by the raw and decoded variants.
  }
  return [...new Set(values)];
}

function containsExactSlug(body: string, expectedSlug: string): boolean {
  const escaped = expectedSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactSlug = new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`, "i");
  return decodedRequestData(body).some((value) => exactSlug.test(value));
}

function extractRpcIds(body: string): string[] {
  const rpcIds = new Set<string>();
  for (const value of decodedRequestData(body)) {
    let candidate = value;
    try {
      const formValue = new URLSearchParams(value).get("f.req");
      if (formValue) candidate = formValue;
    } catch {
      // Continue with the decoded candidate.
    }
    try {
      const batches = JSON.parse(candidate) as unknown;
      if (!Array.isArray(batches)) continue;
      for (const batch of batches) {
        if (!Array.isArray(batch)) continue;
        for (const call of batch) {
          if (Array.isArray(call) && typeof call[0] === "string") rpcIds.add(call[0]);
        }
      }
    } catch {
      const match = candidate.match(/^\s*\[\s*\[\s*\[\s*"([A-Za-z0-9_-]+)"/);
      if (match?.[1]) rpcIds.add(match[1]);
    }
  }
  return [...rpcIds].sort();
}

function classifyBatchedResponse(
  body: string,
  expectedSlug: string,
  requestRpcIds: string[]
): Pick<TrackedDraftSaveRequest, "applicationStatus" | "returnedPermalink"> {
  let sawSuccess = false;
  let sawError = false;
  const matchedPayloads: string[] = [];
  const jsonLines = body
    .replace(/^\)\]\}'[^\r\n]*(?:\r?\n)?/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[") || line.startsWith("{"));

  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (value[0] === "er") sawError = true;
    if (value[0] === "wrb.fr") {
      const responseRpcId = typeof value[1] === "string" ? value[1] : null;
      if (!responseRpcId || !requestRpcIds.includes(responseRpcId)) {
        return;
      }
      if (value[2] === null || value[2] === undefined || value[5] != null) sawError = true;
      else {
        sawSuccess = true;
        if (typeof value[2] === "string") matchedPayloads.push(value[2]);
      }
    }
    for (const child of value) visit(child);
  };

  for (const line of jsonLines) {
    try {
      visit(JSON.parse(line));
    } catch {
      // Chunk lengths and unknown protocol records remain UNKNOWN.
    }
  }
  const decoded = matchedPayloads.flatMap(decodedRequestData).join("\n");
  const expectedSlugPresent = containsExactSlug(decoded, expectedSlug);
  const otherPermalinkPresent = /\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.html(?:["'\\/?#]|$)/i.test(
    decoded
  );
  return {
    applicationStatus: sawError ? "ERROR" : sawSuccess ? "SUCCESS" : "UNKNOWN",
    returnedPermalink: expectedSlugPresent
      ? "EXPECTED_SLUG"
      : otherPermalinkPresent
        ? "OTHER_SLUG"
        : "NOT_OBSERVED"
  };
}

/**
 * Waits for the custom-permalink preview that Blogger emits after the input
 * loses focus.  This is a model-commit boundary, not proof of persistence:
 * the guarded Save transaction and the isolated persistence audit remain
 * required.  Register the waiter before typing so a fast preview cannot be
 * missed, then await it before opening Save.
 */
export async function waitForExpectedPermalinkPreview(
  page: Pick<Page, "waitForResponse">,
  expectedSlug: string,
  timeoutMs = 5000
): Promise<void> {
  const response = await page.waitForResponse(
    (candidate) => {
      const request = candidate.request();
      const body = request.postData();
      return (
        isBloggerMutationRequest(request) &&
        request.method().toUpperCase() === "POST" &&
        body !== null &&
        extractRpcIds(body).includes(BLOGGER_PERMALINK_PREVIEW_RPC_ID) &&
        containsExactSlug(body, expectedSlug)
      );
    },
    { timeout: timeoutMs }
  );
  const status = response.status();
  if (status < 200 || status >= 300) {
    throw new Error(`Blogger custom permalink preview returned HTTP ${status}`);
  }
  const request = response.request();
  const classification = classifyBatchedResponse(
    await response.text(),
    expectedSlug,
    extractRpcIds(request.postData() ?? "")
  );
  if (
    classification.applicationStatus !== "SUCCESS" ||
    classification.returnedPermalink !== "EXPECTED_SLUG"
  ) {
    throw new Error("Blogger custom permalink preview did not confirm the requested slug");
  }
}

/**
 * Records every matching Blogger mutation in a bounded, action-scoped window.
 * Request and response bodies are inspected only in memory; evidence retains
 * hashes, RPC identifiers and classifications, never raw data or the slug.
 */
export function createDraftSaveNetworkObserver(
  page: Pick<Page, "on" | "off">,
  expectedSlug: string,
  options: { now?: () => number; quiescenceMs?: number; postClickGraceMs?: number } = {}
): DraftSaveNetworkObserver {
  const now = options.now ?? Date.now;
  const quiescenceMs = options.quiescenceMs ?? 250;
  const postClickGraceMs = options.postClickGraceMs ?? 2000;
  let armed = false;
  let disposed = false;
  let trackedRequests: TrackedDraftSaveRequest[] = [];
  let resolveTerminal: ((evidence: DraftSaveNetworkTransactionEvidence) => void) | null = null;
  let actionStartedAtMs = 0;
  let explicitSaveClickStartedAtMs: number | null = null;
  let triggerCompleted = false;
  let quiescenceTimer: ReturnType<typeof setTimeout> | undefined;

  const buildEvidence = (timedOut: boolean): DraftSaveNetworkTransactionEvidence => {
    const completedAtMs = now();
    const transactions = trackedRequests.map((tracked): DraftSaveNetworkRequestEvidence => ({
      ordinal: tracked.ordinal,
      requestStartedAt: new Date(tracked.requestStartedAtMs).toISOString(),
      completedAt:
        tracked.completedAtMs === null ? null : new Date(tracked.completedAtMs).toISOString(),
      elapsedMs:
        tracked.completedAtMs === null
          ? null
          : Math.max(0, tracked.completedAtMs - tracked.requestStartedAtMs),
      method: tracked.method,
      url: tracked.url,
      rpcIds: tracked.rpcIds,
      startedAfterExplicitSaveClick: tracked.startedAfterExplicitSaveClick,
      requestBodySha256: tracked.requestBodySha256,
      exactSlugPresent: tracked.exactSlugPresent,
      responseStatus: tracked.responseStatus,
      responseBodySha256: tracked.responseBodySha256,
      applicationStatus: tracked.applicationStatus,
      returnedPermalink: tracked.returnedPermalink,
      terminalStatus: tracked.terminalStatus ?? "TIMED_OUT"
    }));
    const explicitSaveTransactions = transactions.filter(
      (transaction) => transaction.startedAfterExplicitSaveClick
    );
    const correlated = explicitSaveTransactions.find(
      (transaction) =>
        !(
          transaction.rpcIds.length > 0 &&
          transaction.rpcIds.every((rpcId) => rpcId === BLOGGER_PERMALINK_PREVIEW_RPC_ID)
        ) &&
        transaction.exactSlugPresent &&
        transaction.terminalStatus === "SUCCESS" &&
        transaction.applicationStatus === "SUCCESS"
    );
    let terminalStatus: DraftSaveNetworkTerminalStatus;
    if (correlated) terminalStatus = "SUCCESS";
    else if (transactions.length === 0) terminalStatus = "NO_TRANSACTION";
    else if (explicitSaveClickStartedAtMs !== null && explicitSaveTransactions.length === 0) {
      terminalStatus = "NO_POST_CLICK_TRANSACTION";
    } else if (
      timedOut &&
      explicitSaveTransactions.some((transaction) => transaction.terminalStatus === "TIMED_OUT")
    ) {
      terminalStatus = "TIMED_OUT";
    } else if (!explicitSaveTransactions.some((transaction) => transaction.exactSlugPresent)) {
      terminalStatus = "SLUG_NOT_OBSERVED";
    } else if (
      explicitSaveTransactions.some((transaction) => transaction.terminalStatus === "HTTP_ERROR")
    ) {
      terminalStatus = "HTTP_ERROR";
    } else if (
      explicitSaveTransactions.some((transaction) => transaction.applicationStatus === "ERROR")
    ) {
      terminalStatus = "APPLICATION_ERROR";
    } else if (
      explicitSaveTransactions.some(
        (transaction) => transaction.terminalStatus === "REQUEST_FAILED"
      )
    ) {
      terminalStatus = "REQUEST_FAILED";
    } else {
      terminalStatus = "APPLICATION_UNCONFIRMED";
    }
    return {
      terminalStatus,
      actionStartedAt: new Date(actionStartedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
      elapsedMs: Math.max(0, completedAtMs - actionStartedAtMs),
      explicitSaveClickStartedAt:
        explicitSaveClickStartedAtMs === null
          ? null
          : new Date(explicitSaveClickStartedAtMs).toISOString(),
      postClickGraceMs,
      expectedSlugSha256: sha256(expectedSlug),
      correlatedRequestOrdinal: correlated?.ordinal ?? null,
      transactions
    };
  };

  const settle = (timedOut = false): void => {
    const resolve = resolveTerminal;
    if (!resolve) return;
    resolveTerminal = null;
    if (quiescenceTimer) clearTimeout(quiescenceTimer);
    resolve(buildEvidence(timedOut));
  };

  const scheduleQuiescentSettle = (): void => {
    if (
      !armed ||
      !triggerCompleted ||
      trackedRequests.length === 0 ||
      trackedRequests.some((tracked) => tracked.terminalStatus === null)
    ) {
      return;
    }
    if (quiescenceTimer) clearTimeout(quiescenceTimer);
    const hasPostClickTransaction = trackedRequests.some(
      (tracked) => tracked.startedAfterExplicitSaveClick
    );
    const postClickGraceRemainingMs =
      explicitSaveClickStartedAtMs === null || hasPostClickTransaction
        ? 0
        : Math.max(0, postClickGraceMs - (now() - explicitSaveClickStartedAtMs));
    quiescenceTimer = setTimeout(() => settle(), Math.max(quiescenceMs, postClickGraceRemainingMs));
  };

  const onRequest = (request: Request): void => {
    if (!armed || !isBloggerMutationRequest(request)) return;
    if (quiescenceTimer) clearTimeout(quiescenceTimer);
    const body = request.postData();
    const requestStartedAtMs = now();
    trackedRequests.push({
      request,
      ordinal: trackedRequests.length + 1,
      requestStartedAtMs,
      method: request.method().toUpperCase(),
      url: sanitizeRequestUrl(request.url()),
      rpcIds: body === null ? [] : extractRpcIds(body),
      startedAfterExplicitSaveClick:
        explicitSaveClickStartedAtMs !== null && requestStartedAtMs >= explicitSaveClickStartedAtMs,
      requestBodySha256: body === null ? null : sha256(body),
      exactSlugPresent: body !== null && containsExactSlug(body, expectedSlug),
      completedAtMs: null,
      responseStatus: null,
      responseBodySha256: null,
      applicationStatus: "NOT_APPLICABLE",
      returnedPermalink: "NOT_OBSERVED",
      terminalStatus: null
    });
  };
  const onResponse = (response: Response): void => {
    const tracked = trackedRequests.find((candidate) => candidate.request === response.request());
    if (!armed || !tracked || tracked.terminalStatus !== null) return;
    const status = response.status();
    tracked.responseStatus = status;
    void response
      .text()
      .then((body) => {
        tracked.responseBodySha256 = sha256(body);
        const classification = classifyBatchedResponse(body, expectedSlug, tracked.rpcIds);
        tracked.returnedPermalink = classification.returnedPermalink;
        tracked.applicationStatus =
          status >= 200 && status < 300 ? classification.applicationStatus : "NOT_APPLICABLE";
      })
      .catch(() => {
        tracked.applicationStatus = status >= 200 && status < 300 ? "UNKNOWN" : "NOT_APPLICABLE";
      })
      .finally(() => {
        tracked.completedAtMs = now();
        tracked.terminalStatus = status >= 200 && status < 300 ? "SUCCESS" : "HTTP_ERROR";
        scheduleQuiescentSettle();
      });
  };
  const onRequestFailed = (request: Request): void => {
    const tracked = trackedRequests.find((candidate) => candidate.request === request);
    if (!armed || !tracked || tracked.terminalStatus !== null) return;
    tracked.completedAtMs = now();
    tracked.terminalStatus = "REQUEST_FAILED";
    scheduleQuiescentSettle();
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    armed = false;
    resolveTerminal = null;
    if (quiescenceTimer) clearTimeout(quiescenceTimer);
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  };

  return {
    markExplicitSaveClick(): void {
      if (!armed) throw new Error("Blogger draft Save network observer is not active");
      if (explicitSaveClickStartedAtMs !== null) {
        throw new Error("Blogger explicit Save click was already marked");
      }
      explicitSaveClickStartedAtMs = now();
    },
    async run<T>(
      trigger: () => Promise<T>,
      timeoutMs = 15000
    ): Promise<{ value: T; evidence: DraftSaveNetworkTransactionEvidence }> {
      if (disposed) throw new Error("Blogger draft Save network observer is disposed");
      if (armed) throw new Error("Blogger draft Save network observer is already active");
      trackedRequests = [];
      actionStartedAtMs = now();
      explicitSaveClickStartedAtMs = null;
      triggerCompleted = false;
      armed = true;

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const terminal = new Promise<DraftSaveNetworkTransactionEvidence>((resolve) => {
        resolveTerminal = resolve;
      });

      try {
        const value = await trigger();
        triggerCompleted = true;
        // The UI mutation has its own bounded waits. Start this timeout only
        // after the trigger returns so a slow editor render cannot expire the
        // network observation before the explicit Save click is attempted.
        timeout = setTimeout(() => settle(true), timeoutMs);
        scheduleQuiescentSettle();
        const evidence = await terminal;
        return { value, evidence };
      } finally {
        if (timeout) clearTimeout(timeout);
        triggerCompleted = false;
        armed = false;
        resolveTerminal = null;
        if (quiescenceTimer) clearTimeout(quiescenceTimer);
      }
    },
    dispose
  };
}

export function assertSuccessfulDraftSaveTransaction(
  evidence: DraftSaveNetworkTransactionEvidence
): void {
  if (evidence.terminalStatus === "SUCCESS") return;
  throw new Error(
    `Blogger draft Save action did not produce a successful terminal network transaction: ${JSON.stringify(evidence)}`
  );
}

/**
 * Waits for evidence produced after an explicit draft Save click. Blogger can
 * leave its "Changes saved" icon visible while the editor is idle, so that
 * pre-existing visibility must never be accepted as proof of the new save.
 * A fresh-context persistence audit remains the definitive success gate.
 */
export async function waitForDraftSaveCompletion(input: {
  page: Pick<Page, "waitForLoadState" | "waitForTimeout">;
  saveMenuItem: Pick<Locator, "isVisible" | "waitFor">;
  savedIndicator: Pick<Locator, "isVisible" | "waitFor">;
  savedIndicatorVisibleBeforeClick: boolean;
  menuCloseTimeoutMs?: number;
  indicatorTimeoutMs?: number;
  quiescenceMs?: number;
}): Promise<DraftSaveCompletionResult> {
  const menuCloseTimeoutMs = input.menuCloseTimeoutMs ?? 10000;
  const indicatorTimeoutMs = input.indicatorTimeoutMs ?? 30000;
  const quiescenceMs = input.quiescenceMs ?? 2000;

  await input.saveMenuItem.waitFor({ state: "hidden", timeout: menuCloseTimeoutMs }).catch(() => {
    throw new Error("Blogger draft Save menu did not close after the save click");
  });
  if (await input.saveMenuItem.isVisible()) {
    throw new Error("Blogger draft Save menu did not close after the save click");
  }

  let savedIndicatorTransitionObserved = false;
  if (!input.savedIndicatorVisibleBeforeClick) {
    await input.savedIndicator.waitFor({ state: "visible", timeout: indicatorTimeoutMs });
    savedIndicatorTransitionObserved = true;
  }

  let networkIdleObserved = true;
  await input.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {
    networkIdleObserved = false;
  });
  await input.page.waitForTimeout(quiescenceMs);

  return {
    savedIndicatorVisibleBeforeClick: input.savedIndicatorVisibleBeforeClick,
    savedIndicatorTransitionObserved,
    saveMenuClosed: true,
    networkIdleObserved,
    quiescenceMs
  };
}

/**
 * Runs an editor change while observing a newly produced saved-state
 * transition. When the saved icon was already visible, it must disappear and
 * reappear; its pre-existing visibility is never accepted as recognition.
 */
export async function performDraftChangeWithRecognition<T>(input: {
  savedIndicator: Pick<Locator, "isVisible" | "waitFor">;
  mutate: () => Promise<T>;
  transitionTimeoutMs?: number;
}): Promise<{ value: T; recognition: DraftChangeRecognitionResult }> {
  const transitionTimeoutMs = input.transitionTimeoutMs ?? 15000;
  const savedIndicatorVisibleBeforeChange = await input.savedIndicator.isVisible();
  const hiddenTransition = savedIndicatorVisibleBeforeChange
    ? input.savedIndicator
        .waitFor({ state: "hidden", timeout: transitionTimeoutMs })
        .then(() => true)
        .catch(() => false)
    : Promise.resolve(false);

  const value = await input.mutate();
  const savedIndicatorHiddenAfterChange = await hiddenTransition;
  if (savedIndicatorVisibleBeforeChange && !savedIndicatorHiddenAfterChange) {
    throw new Error("Blogger did not recognize the permalink edit as a new draft change");
  }
  await input.savedIndicator.waitFor({ state: "visible", timeout: transitionTimeoutMs });

  return {
    value,
    recognition: {
      savedIndicatorVisibleBeforeChange,
      savedIndicatorHiddenAfterChange,
      savedIndicatorVisibleAfterChange: true
    }
  };
}

export async function uploadDraftImageWithGuard(
  assertCanMutate: (() => Promise<void>) | undefined,
  upload: () => Promise<ImageUploadResult>
): Promise<ImageUploadResult> {
  await assertCanMutate?.();
  return upload();
}

export class BloggerDryRunClient {
  constructor(
    private readonly config: AppConfig,
    private readonly selectors: BloggerSelectors
  ) {}

  async run(input: {
    adminUrl: string;
    postEditorUrl?: string;
    article: ArticleInput;
    artifactDir: string;
  }): Promise<DryRunResult> {
    if (!this.config.ENABLE_DRY_RUN) {
      throw new Error("Dry-run is disabled by ENABLE_DRY_RUN=false");
    }
    if (this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error("Dry-run refuses to run while publish-capable flags are enabled");
    }
    requireDryRunEditorTarget(input.adminUrl, input.postEditorUrl);

    const context = await this.openContext();
    try {
      const page = await context.newPage();
      const mutationGuard = await installDryRunNetworkGuard(page);
      await page.goto(input.postEditorUrl ?? input.adminUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertSessionReady(page, input.artifactDir);
      await this.openPostEditorIfNeeded(page, input.artifactDir, input.article.title);
      await this.assertSessionReady(page, input.artifactDir);
      await this.assertEditorIdentity(page, input.artifactDir, input.adminUrl, input.postEditorUrl);
      const { postSettings, schedulePreview } = await this.fillArticle(
        page,
        input.article,
        input.artifactDir
      );
      await page.waitForTimeout(2000);
      const screenshotPath = await this.capture(page, input.artifactDir, "dry-run.png");
      const publishButtonVisible = await this.firstVisible(
        page.locator(this.selectors.publishButton)
      ).then(Boolean);
      return {
        screenshotPath,
        currentUrl: sanitizeRequestUrl(page.url()),
        publishButtonVisible,
        postSettings,
        schedulePreview,
        networkGuard: mutationGuard.snapshot()
      };
    } finally {
      await context.close();
    }
  }

  async findDrafts(input: { adminUrl: string; title: string }): Promise<DraftAuditResult> {
    const context = await this.openContext();
    try {
      const page = await context.newPage();
      await page.goto(input.adminUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertReadOnlySessionReady(page);
      const matches = page.getByText(input.title, { exact: true });
      const urls = new Set<string>();
      const rowTexts = new Set<string>();
      const count = await matches.count();
      for (let index = 0; index < count; index += 1) {
        const match = matches.nth(index);
        if (!(await match.isVisible().catch(() => false))) continue;
        const row = match.locator(
          'xpath=ancestor::*[.//a[contains(@href, "/blog/post/edit/")]][1]'
        );
        const rowText = await row.innerText().catch(() => "");
        if (rowText.trim()) rowTexts.add(rowText.trim());
        const link = match
          .locator(
            'xpath=ancestor::*[.//a[contains(@href, "/blog/post/edit/")]][1]//a[contains(@href, "/blog/post/edit/")]'
          )
          .first();
        const href = await link.getAttribute("href").catch(() => null);
        const editUrl = normalizeBloggerEditUrl(href, page.url());
        if (editUrl) urls.add(editUrl);
      }
      const editUrls = [...urls];
      return { title: input.title, editUrls, count: editUrls.length, rowTexts: [...rowTexts] };
    } finally {
      await context.close();
    }
  }

  /** Reads the Blogger post list without opening any post editor or changing state. */
  async listPosts(input: {
    adminUrl: string;
  }): Promise<{ blogId: string; posts: BloggerPostListEntry[] }> {
    const context = await this.openContext();
    try {
      const page = await context.newPage();
      await page.goto(input.adminUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertReadOnlySessionReady(page);
      const blogId = extractBloggerBlogId(input.adminUrl);
      if (!blogId) throw new Error("Blogger post-list URL does not contain a blog ID");
      const rows = page.locator('[role="listitem"]:has(a[href*="/blog/post/edit/"])');
      const posts: BloggerPostListEntry[] = [];
      const count = await rows.count();
      for (let index = 0; index < count; index += 1) {
        const row = rows.nth(index);
        if (!(await row.isVisible().catch(() => false))) continue;
        const link = row.locator('a[href*="/blog/post/edit/"]').first();
        const href = await link.getAttribute("href").catch(() => null);
        if (!href) continue;
        const editUrl = normalizeBloggerEditUrl(href, page.url());
        if (!editUrl) continue;
        const rowText = (await row.innerText().catch(() => "")).trim();
        const title = (
          await row
            .locator('[id^="post-title-"]')
            .first()
            .innerText()
            .catch(() => "")
        ).trim();
        if (!title) continue;
        posts.push({
          postId: extractBloggerPostId(editUrl),
          editUrl,
          title,
          postState: this.detectPostListState(rowText),
          rowText
        });
      }
      return { blogId, posts };
    } finally {
      await context.close();
    }
  }

  /**
   * Reads an existing editor in a fresh browser context. This method must not
   * click, fill, or otherwise mutate Blogger; it is used by the post-save
   * audit rather than any draft-save or scheduling workflow.
   */
  async inspectExistingDraft(input: {
    adminUrl: string;
    postEditorUrl: string;
  }): Promise<ExistingDraftInspection> {
    const context = await this.openContext();
    try {
      const page = await context.newPage();
      await page.goto(input.postEditorUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertReadOnlySessionReady(page);
      const identity = validateBloggerEditorIdentity({
        adminUrl: input.adminUrl,
        postEditorUrl: input.postEditorUrl,
        currentUrl: sanitizeRequestUrl(page.url())
      });
      const titleInput = await this.firstEditable(page.locator(this.selectors.titleInput), 10000);
      if (!titleInput) throw new Error("Blogger existing draft editor was not detected");
      const [labelsValue, searchDescription, slug, scheduledDate, scheduledTime, publishedAt] =
        await Promise.all([
          this.readInputValue(page, this.selectors.labelsInput),
          this.readInputValue(page, this.selectors.searchDescriptionInput),
          this.readInputValue(page, this.selectors.permalinkInput),
          this.readInputValue(page, this.selectors.scheduleDateInput),
          this.readInputValue(page, this.selectors.scheduleTimeInput),
          this.readPublishDateText(page)
        ]);
      const publish = await this.firstVisible(page.locator(this.selectors.publishButton), 5000);
      const publishText = await this.readPublishActionText(publish);
      return {
        blogId: identity.actualBlogId,
        postId: extractBloggerPostId(sanitizeRequestUrl(page.url())),
        editUrl: sanitizeRequestUrl(page.url()),
        postState: this.detectPostState({
          publishText,
          publishVisible: Boolean(publish),
          scheduledDate,
          scheduledTime
        }),
        publishedAt,
        scheduledDate: scheduledDate || undefined,
        scheduledTime: scheduledTime || undefined,
        title: await titleInput.inputValue(),
        html: await this.readDraftHtml(page),
        labels: labelsValue
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
        searchDescription: searchDescription.trim(),
        slug: slug.trim().toLowerCase(),
        imageCount: await this.countDraftImages(page)
      };
    } finally {
      await context.close();
    }
  }
  async saveDraft(input: {
    adminUrl: string;
    postEditorUrl?: string;
    article: ArticleInput;
    artifactDir: string;
    assertCanMutate: () => Promise<void>;
  }): Promise<DraftSaveResult> {
    if (!this.config.ENABLE_DRAFT_SAVE) {
      throw new Error("Draft save is disabled by ENABLE_DRAFT_SAVE=false");
    }
    if (this.config.ENABLE_SCHEDULED_POST) {
      throw new Error("Draft save refuses to run while scheduled posting is enabled");
    }
    requireDraftMutationGuard(input.assertCanMutate);

    const context = await this.openContext();
    try {
      const page = await context.newPage();
      await page.goto(input.postEditorUrl ?? input.adminUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertSessionReady(page, input.artifactDir);
      await this.openPostEditorIfNeeded(
        page,
        input.artifactDir,
        input.article.title,
        input.assertCanMutate
      );
      await this.assertSessionReady(page, input.artifactDir);
      await this.assertEditorIdentity(page, input.artifactDir, input.adminUrl, input.postEditorUrl);
      if (input.postEditorUrl) await this.assertExistingDraftStatus(page);
      await input.assertCanMutate?.();
      let { postSettings, schedulePreview } = await this.fillArticle(
        page,
        input.article,
        input.artifactDir,
        input.assertCanMutate
      );
      let imageUpload: ImageUploadResult | undefined;
      if (input.article.imagePath) {
        try {
          imageUpload = await uploadDraftImageWithGuard(input.assertCanMutate, () =>
            new BloggerImageUploader(this.selectors).upload(
              page,
              input.article.imagePath!,
              input.assertCanMutate
            )
          );
        } catch (error) {
          const diagnostic = await this.writeDiagnostic(
            page,
            input.artifactDir,
            "image-upload-failed"
          );
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}. Diagnostic screenshot: ${diagnostic.screenshotPath}. HTML: ${diagnostic.htmlPath}`
          );
        }
      }
      // Image insertion switches Blogger into Compose mode. Only labels need
      // to be replayed there so their autocomplete model commits on blur.
      // Search description and permalink were already applied before upload;
      // reopening those sections after the Picker closes is unreliable.
      await new BloggerPostSettings(this.selectors).reapplyLabelsAfterImage(
        page,
        input.article,
        input.assertCanMutate
      );
      const savedIndicator = page.locator(this.selectors.saveCompleteIndicator).first();
      const moreOptions = await this.firstVisible(
        page.locator(this.selectors.moreOptionsButton),
        5000
      );
      if (moreOptions) {
        await performDraftMutationWithGuard(input.assertCanMutate, () => moreOptions.click());
        const saveMenuItem = await this.firstVisible(
          page.locator(this.selectors.saveMenuItem),
          5000
        );
        if (!saveMenuItem) throw new Error("Blogger draft Save menu item was not detected");
        const clicked = await clickDraftSaveButtonWithGuard(saveMenuItem, async () => {
          await this.assertSessionReady(page, input.artifactDir);
          await this.assertEditorIdentity(
            page,
            input.artifactDir,
            input.adminUrl,
            input.postEditorUrl
          );
          await input.assertCanMutate?.();
        });
        if (!clicked) throw new Error("Blogger draft Save menu item is disabled");
      } else {
        const saveButton = await this.firstVisible(page.locator(this.selectors.saveButton), 10000);
        if (saveButton) {
          const clicked = await clickDraftSaveButtonWithGuard(saveButton, async () => {
            await this.assertSessionReady(page, input.artifactDir);
            await this.assertEditorIdentity(
              page,
              input.artifactDir,
              input.adminUrl,
              input.postEditorUrl
            );
            await input.assertCanMutate?.();
          });
          if (!clicked) throw new Error("Blogger draft Save button is disabled");
        } else {
          const alreadySaved = await savedIndicator
            .waitFor({ state: "visible", timeout: 30000 })
            .then(() => true)
            .catch(() => false);
          if (!alreadySaved) {
            const diagnostic = await this.writeDiagnostic(
              page,
              input.artifactDir,
              "save-button-not-found"
            );
            throw new Error(
              `Blogger draft Save button was not detected. Diagnostic screenshot: ${diagnostic.screenshotPath}. HTML: ${diagnostic.htmlPath}`
            );
          }
        }
      }
      await savedIndicator.waitFor({ state: "visible", timeout: 15000 });
      await this.assertSessionReady(page, input.artifactDir);
      await this.assertEditorIdentity(page, input.artifactDir, input.adminUrl, input.postEditorUrl);
      const screenshotPath = await this.capture(page, input.artifactDir, "draft-saved.png");
      return {
        screenshotPath,
        currentUrl: sanitizeRequestUrl(page.url()),
        savedAt: new Date().toISOString(),
        imageUpload,
        postSettings,
        schedulePreview
      };
    } finally {
      await context.close();
    }
  }
  async schedulePost(input: {
    adminUrl: string;
    postEditorUrl?: string;
    article: ArticleInput;
    artifactDir: string;
    assertCanMutate: () => Promise<void>;
  }): Promise<ScheduledPostResult> {
    if (!this.config.ENABLE_SCHEDULED_POST || this.config.ENABLE_DRAFT_SAVE) {
      throw new Error(
        "Scheduled post requires ENABLE_SCHEDULED_POST=true and ENABLE_DRAFT_SAVE=false"
      );
    }
    if (!input.article.scheduledAt) throw new Error("Scheduled post requires scheduledAt");
    await this.assertPersistedDraftBeforeScheduling(input);
    requireDraftMutationGuard(input.assertCanMutate);
    const context = await this.openContext();
    try {
      const page = await context.newPage();
      await page.goto(input.postEditorUrl ?? input.adminUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertSessionReady(page, input.artifactDir);
      await this.openPostEditorIfNeeded(
        page,
        input.artifactDir,
        input.article.title,
        input.assertCanMutate
      );
      await this.assertEditorIdentity(page, input.artifactDir, input.adminUrl, input.postEditorUrl);
      const { postSettings, schedulePreview } = await this.fillArticle(
        page,
        input.article,
        input.artifactDir,
        input.assertCanMutate
      );
      let imageUpload: ImageUploadResult | undefined;
      if (input.article.imagePath) {
        const existingImageCount = await page.locator(this.selectors.insertedImage).count();
        if (existingImageCount > 1) {
          throw new Error("Scheduled post contains more than one image before execution");
        }
        if (existingImageCount === 0) {
          imageUpload = await uploadDraftImageWithGuard(input.assertCanMutate, () =>
            new BloggerImageUploader(this.selectors).upload(
              page,
              input.article.imagePath!,
              input.assertCanMutate
            )
          );
        }
      }
      const publish = await this.firstVisible(page.locator(this.selectors.publishButton), 10000);
      if (!publish) throw new Error("Blogger Publish button was not detected");
      await performDraftMutationWithGuard(input.assertCanMutate, () => publish.click());
      const confirm = await this.firstVisible(
        page.locator(this.selectors.publishConfirmButton),
        10000
      );
      if (!confirm) throw new Error("Blogger schedule confirmation button was not detected");
      await performDraftMutationWithGuard(input.assertCanMutate, () => confirm.click());
      await page.waitForTimeout(3000);
      await this.assertSessionReady(page, input.artifactDir);
      const screenshotPath = await this.capture(page, input.artifactDir, "schedule-confirmed.png");
      return {
        screenshotPath,
        currentUrl: sanitizeRequestUrl(page.url()),
        savedAt: new Date().toISOString(),
        scheduledAt: schedulePreview?.scheduledAt ?? input.article.scheduledAt,
        imageUpload,
        postSettings,
        schedulePreview
      };
    } finally {
      await context.close();
    }
  }
  async updateScheduledPostImage(input: {
    adminUrl: string;
    postEditorUrl: string;
    article: ArticleInput;
    artifactDir: string;
    assertCanMutate: () => Promise<void>;
  }): Promise<ScheduledImageRepairResult> {
    if (!this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Scheduled image repair requires ENABLE_DRAFT_SAVE=true and ENABLE_SCHEDULED_POST=false"
      );
    }
    if (!input.article.imagePath) throw new Error("Scheduled image repair requires imagePath");
    requireDraftMutationGuard(input.assertCanMutate);
    const context = await this.openContext();
    try {
      const page = await context.newPage();
      await page.goto(input.postEditorUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertSessionReady(page, input.artifactDir);
      await this.assertEditorIdentity(page, input.artifactDir, input.adminUrl, input.postEditorUrl);
      const titleInput = await this.firstEditable(page.locator(this.selectors.titleInput), 10000);
      if (!titleInput) throw new Error("Blogger scheduled post editor was not detected");
      validateDraftTitle(await titleInput.inputValue(), input.article.title);
      const imageUpload = await uploadDraftImageWithGuard(input.assertCanMutate, () =>
        new BloggerImageUploader(this.selectors).upload(
          page,
          input.article.imagePath!,
          input.assertCanMutate
        )
      );
      const saveButton = await this.firstVisible(page.locator(this.selectors.saveButton), 10000);
      if (saveButton) await clickDraftSaveButtonWithGuard(saveButton, input.assertCanMutate);
      await page.locator(this.selectors.saveCompleteIndicator).first().waitFor({
        state: "visible",
        timeout: 30000
      });
      const screenshotPath = await this.capture(
        page,
        input.artifactDir,
        "scheduled-image-repaired.png"
      );
      return {
        screenshotPath,
        currentUrl: sanitizeRequestUrl(page.url()),
        savedAt: new Date().toISOString(),
        imageUpload
      };
    } finally {
      await context.close();
    }
  }
  async updateScheduledPostPermalink(input: {
    adminUrl: string;
    postEditorUrl: string;
    expectedTitle: string;
    slug: string;
    artifactDir: string;
    assertCanMutate: () => Promise<void>;
  }): Promise<ScheduledPermalinkRepairResult> {
    if (!this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Scheduled permalink repair requires ENABLE_DRAFT_SAVE=true and ENABLE_SCHEDULED_POST=false"
      );
    }
    requireDraftMutationGuard(input.assertCanMutate);
    const context = await this.openContext();
    try {
      const page = await context.newPage();
      await page.goto(input.postEditorUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertSessionReady(page, input.artifactDir);
      await this.assertEditorIdentity(page, input.artifactDir, input.adminUrl, input.postEditorUrl);
      const titleInput = await this.firstEditable(page.locator(this.selectors.titleInput), 10000);
      if (!titleInput) throw new Error("Blogger scheduled post editor was not detected");
      validateDraftTitle(await titleInput.inputValue(), input.expectedTitle);
      const scheduledDate = await this.readInputValue(page, this.selectors.scheduleDateInput);
      const scheduledTime = await this.readInputValue(page, this.selectors.scheduleTimeInput);
      const publish = await this.firstVisible(page.locator(this.selectors.publishButton), 5000);
      const publishText = await this.readPublishActionText(publish);
      if (
        this.detectPostState({
          publishText,
          publishVisible: Boolean(publish),
          scheduledDate,
          scheduledTime
        }) !== "SCHEDULED"
      ) {
        throw new Error("Scheduled permalink repair requires an editable scheduled post");
      }
      const appliedSlug = await new BloggerPostSettings(this.selectors).applyCustomPermalinkOnly(
        page,
        input.slug,
        input.assertCanMutate
      );
      const saveButton = await this.firstVisible(page.locator(this.selectors.saveButton), 10000);
      if (!saveButton) throw new Error("Blogger scheduled permalink Save control was not detected");
      await clickDraftSaveButtonWithGuard(saveButton, input.assertCanMutate);
      await page
        .locator(this.selectors.saveCompleteIndicator)
        .first()
        .waitFor({ state: "visible", timeout: 30000 });
      const screenshotPath = await this.capture(
        page,
        input.artifactDir,
        "scheduled-permalink-repaired.png"
      );
      return {
        screenshotPath,
        currentUrl: sanitizeRequestUrl(page.url()),
        savedAt: new Date().toISOString(),
        slug: appliedSlug
      };
    } finally {
      await context.close();
    }
  }
  /** Moves one scheduled post back to a draft without editing content or metadata. */
  async revertScheduledPostToDraft(input: {
    adminUrl: string;
    postEditorUrl: string;
    expectedTitle: string;
    artifactDir: string;
    assertCanMutate: () => Promise<void>;
  }): Promise<ScheduledPostDraftRecoveryResult> {
    if (!this.config.ENABLE_SCHEDULED_POST || this.config.ENABLE_DRAFT_SAVE) {
      throw new Error(
        "Scheduled draft recovery requires ENABLE_SCHEDULED_POST=true and ENABLE_DRAFT_SAVE=false"
      );
    }
    requireDraftMutationGuard(input.assertCanMutate);
    const context = await this.openContext();
    try {
      const page = await context.newPage();
      await page.goto(input.postEditorUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertSessionReady(page, input.artifactDir);
      await this.assertEditorIdentity(page, input.artifactDir, input.adminUrl, input.postEditorUrl);
      const titleInput = await this.firstEditable(page.locator(this.selectors.titleInput), 10000);
      if (!titleInput) throw new Error("Blogger scheduled post editor was not detected");
      validateDraftTitle(await titleInput.inputValue(), input.expectedTitle);
      const scheduledDate = await this.readInputValue(page, this.selectors.scheduleDateInput);
      const scheduledTime = await this.readInputValue(page, this.selectors.scheduleTimeInput);
      const publish = await this.firstVisible(page.locator(this.selectors.publishButton), 5000);
      const publishText = await this.readPublishActionText(publish);
      if (
        this.detectPostState({
          publishText,
          publishVisible: Boolean(publish),
          scheduledDate,
          scheduledTime
        }) !== "SCHEDULED"
      ) {
        throw new Error("Scheduled draft recovery requires an editable scheduled post");
      }
      const moreOptions = await this.firstVisible(
        page.locator(this.selectors.moreOptionsButton),
        5000
      );
      if (!moreOptions) throw new Error("Blogger More options control was not detected");
      await performDraftMutationWithGuard(input.assertCanMutate, () => moreOptions.click());
      const revert =
        (await this.firstVisible(
          page.getByRole("menuitem", {
            name: /^(\u4e0b\u66f8\u304d\u306b\u623b\u3059|Revert to draft)$/
          }),
          5000
        )) ?? (await this.firstVisible(page.locator(this.selectors.revertToDraftMenuItem), 5000));
      if (!revert) {
        const diagnostic = await this.writeDiagnostic(
          page,
          input.artifactDir,
          "revert-to-draft-action-not-detected"
        );
        throw new Error(
          `Blogger Revert to draft action was not detected. Diagnostic screenshot: ${diagnostic.screenshotPath}. HTML: ${diagnostic.htmlPath}`
        );
      }
      await performDraftMutationWithGuard(input.assertCanMutate, () => revert.click());
      const confirm = await this.firstVisible(
        page.locator(this.selectors.revertToDraftConfirmButton),
        1000
      );
      if (confirm)
        await performDraftMutationWithGuard(input.assertCanMutate, () => confirm.click());
      // Blogger performs the conversion asynchronously. Do not press Update:
      // that control is disabled while the server-side reversion is pending.
      await page.waitForTimeout(3000);
      const screenshotPath = await this.capture(
        page,
        input.artifactDir,
        "scheduled-post-reverted-to-draft.png"
      );
      return {
        screenshotPath,
        currentUrl: sanitizeRequestUrl(page.url()),
        changedAt: new Date().toISOString()
      };
    } finally {
      await context.close();
    }
  }

  /** Saves only a custom permalink to an existing draft. */
  async updateExistingDraftPermalink(input: {
    adminUrl: string;
    postEditorUrl: string;
    expectedTitle: string;
    slug: string;
    artifactDir: string;
    assertCanMutate: () => Promise<void>;
  }): Promise<ScheduledPermalinkRepairResult> {
    if (!this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Draft permalink repair requires ENABLE_DRAFT_SAVE=true and ENABLE_SCHEDULED_POST=false"
      );
    }
    requireDraftMutationGuard(input.assertCanMutate);
    const context = await this.openContext();
    let saveNetworkObserver: DraftSaveNetworkObserver | undefined;
    try {
      const page = await context.newPage();
      await page.goto(input.postEditorUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertSessionReady(page, input.artifactDir);
      await this.assertEditorIdentity(page, input.artifactDir, input.adminUrl, input.postEditorUrl);
      await this.assertExistingDraftStatus(page);
      const titleInput = await this.firstEditable(page.locator(this.selectors.titleInput), 10000);
      if (!titleInput) throw new Error("Blogger existing draft editor was not detected");
      validateDraftTitle(await titleInput.inputValue(), input.expectedTitle);
      const savedIndicator = page.locator(this.selectors.saveCompleteIndicator).first();
      const beforeInput = await this.capturePermalinkUiSnapshot(page, savedIndicator);
      const expectedSlug = input.slug.trim().toLowerCase();
      saveNetworkObserver = createDraftSaveNetworkObserver(page, expectedSlug);
      const observedSave = await saveNetworkObserver.run(async () => {
        // Blogger serializes the editor model on blur.  The prior
        // focus-preserving flow let the L3WS8 preview and Me2Pwc Save race,
        // producing a successful Save RPC that omitted the slug.  Arm this
        // waiter before typing, blur normally, and require the expected
        // preview response before the single guarded Save activation.
        const previewCommit = waitForExpectedPermalinkPreview(page, expectedSlug);
        let appliedSlug: string;
        try {
          appliedSlug = await new BloggerPostSettings(this.selectors).applyCustomPermalinkOnly(
            page,
            input.slug,
            input.assertCanMutate
          );
          await previewCommit;
        } catch (error) {
          await previewCommit.catch(() => undefined);
          throw error;
        }
        const afterInput = await this.capturePermalinkUiSnapshot(page, savedIndicator);
        if (afterInput.inputValue !== appliedSlug || afterInput.customOptionChecked !== "true") {
          throw new Error("Blogger custom permalink input did not retain the requested value");
        }

        // The preview has confirmed the blurred input before Save is opened.
        // Activate the exact Save item once by keyboard; this avoids the
        // pointer route that previously left the menu open.
        const beforeSaveClick = afterInput;
        const savedIndicatorVisibleBeforeClick = afterInput.savedIndicatorVisible;

        const moreOptions = await this.firstVisible(
          page.locator(this.selectors.moreOptionsButton),
          5000
        );
        if (!moreOptions) throw new Error("Blogger draft More options control was not detected");
        await performDraftMutationWithGuard(input.assertCanMutate, () => moreOptions.click());
        const exactSaveMenuItem = page.getByRole("menuitem", { name: /^(保存|Save)$/ });
        const save =
          (await this.firstVisible(exactSaveMenuItem, 5000)) ??
          (await this.firstVisible(page.locator(this.selectors.saveMenuItem), 1000));
        if (!save) throw new Error("Blogger draft Save menu item was not detected");
        const clicked = await pressDraftSaveMenuItemWithGuard(save, input.assertCanMutate, () =>
          saveNetworkObserver?.markExplicitSaveClick()
        );
        return {
          appliedSlug,
          afterInput,
          save,
          beforeSaveClick,
          savedIndicatorVisibleBeforeClick,
          clicked
        };
      });
      if (!observedSave.value.clicked) {
        throw new Error("Blogger draft Save menu item is disabled");
      }
      assertSuccessfulDraftSaveTransaction(observedSave.evidence);
      let saveCompletion: DraftSaveCompletionResult;
      try {
        saveCompletion = await waitForDraftSaveCompletion({
          page,
          saveMenuItem: observedSave.value.save,
          savedIndicator,
          savedIndicatorVisibleBeforeClick: observedSave.value.savedIndicatorVisibleBeforeClick
        });
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; networkTransaction=${JSON.stringify(observedSave.evidence)}`
        );
      }
      saveCompletion.networkTransaction = observedSave.evidence;
      saveCompletion.uiSnapshots = {
        beforeInput,
        afterInput: observedSave.value.afterInput,
        beforeSaveClick: observedSave.value.beforeSaveClick
      };
      const screenshotPath = await this.capture(
        page,
        input.artifactDir,
        "draft-permalink-saved.png"
      );
      return {
        screenshotPath,
        currentUrl: sanitizeRequestUrl(page.url()),
        savedAt: new Date().toISOString(),
        slug: observedSave.value.appliedSlug,
        saveCompletion
      };
    } finally {
      saveNetworkObserver?.dispose();
      await context.close();
    }
  }

  /** Schedules an existing verified draft without editing its content or metadata. */
  async scheduleExistingDraftAt(input: {
    adminUrl: string;
    postEditorUrl: string;
    expectedTitle: string;
    scheduledAt: string;
    artifactDir: string;
    assertCanMutate: () => Promise<void>;
  }): Promise<ScheduledPostResult> {
    if (!this.config.ENABLE_SCHEDULED_POST || this.config.ENABLE_DRAFT_SAVE) {
      throw new Error(
        "Draft rescheduling requires ENABLE_SCHEDULED_POST=true and ENABLE_DRAFT_SAVE=false"
      );
    }
    requireDraftMutationGuard(input.assertCanMutate);
    const context = await this.openContext();
    try {
      const page = await context.newPage();
      await page.goto(input.postEditorUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertSessionReady(page, input.artifactDir);
      await this.assertEditorIdentity(page, input.artifactDir, input.adminUrl, input.postEditorUrl);
      await this.assertExistingDraftStatus(page);
      const titleInput = await this.firstEditable(page.locator(this.selectors.titleInput), 10000);
      if (!titleInput) throw new Error("Blogger existing draft editor was not detected");
      validateDraftTitle(await titleInput.inputValue(), input.expectedTitle);
      const schedulePreview = await new BloggerSchedulePreview(
        this.selectors,
        this.config.APP_TIMEZONE
      ).apply(page, input.scheduledAt, input.assertCanMutate);
      const publish = await this.firstVisible(page.locator(this.selectors.publishButton), 10000);
      if (!publish) throw new Error("Blogger Publish button was not detected");
      await performDraftMutationWithGuard(input.assertCanMutate, () => publish.click());
      const confirm = await this.firstVisible(
        page.locator(this.selectors.publishConfirmButton),
        10000
      );
      if (!confirm) throw new Error("Blogger schedule confirmation button was not detected");
      await performDraftMutationWithGuard(input.assertCanMutate, () => confirm.click());
      await page.waitForTimeout(1500);
      const screenshotPath = await this.capture(page, input.artifactDir, "draft-rescheduled.png");
      return {
        screenshotPath,
        currentUrl: sanitizeRequestUrl(page.url()),
        savedAt: new Date().toISOString(),
        scheduledAt: schedulePreview.scheduledAt
      };
    } finally {
      await context.close();
    }
  }

  async updateExistingDraftImage(input: {
    adminUrl: string;
    postEditorUrl: string;
    article: ArticleInput;
    artifactDir: string;
    assertCanMutate: () => Promise<void>;
  }): Promise<ExistingDraftImageUpdateResult> {
    if (!this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Existing draft image update requires ENABLE_DRAFT_SAVE=true and ENABLE_SCHEDULED_POST=false"
      );
    }
    if (!input.article.imagePath) {
      throw new Error("Existing draft image update requires imagePath");
    }
    requireDraftMutationGuard(input.assertCanMutate);
    const context = await this.openContext();
    try {
      const page = await context.newPage();
      await page.goto(input.postEditorUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertSessionReady(page, input.artifactDir);
      await this.assertEditorIdentity(page, input.artifactDir, input.adminUrl, input.postEditorUrl);
      await this.assertExistingDraftStatus(page);
      const titleInput = await this.firstEditable(page.locator(this.selectors.titleInput), 10000);
      if (!titleInput) throw new Error("Blogger existing draft editor was not detected");
      validateDraftTitle(await titleInput.inputValue(), input.article.title);
      const preImageCount = await page.locator(this.selectors.insertedImage).count();
      if (preImageCount !== 0) {
        throw new Error(
          `Existing draft image update requires zero existing images, found ${preImageCount}`
        );
      }
      const imageUpload = await uploadDraftImageWithGuard(input.assertCanMutate, () =>
        new BloggerImageUploader(this.selectors).upload(
          page,
          input.article.imagePath!,
          input.assertCanMutate
        )
      );
      // Image insertion already dirties the draft. Do not add and remove a
      // space in the article body merely to force saving: that can alter
      // editor markup. Blogger's top "More options" menu is the stable save
      // route in the Japanese UI after an image insertion.
      const moreOptions = await this.firstVisible(
        page.locator(this.selectors.moreOptionsButton),
        5000
      );
      if (!moreOptions) {
        throw new Error("Blogger draft Save control was not detected after image insertion");
      }
      await performDraftMutationWithGuard(input.assertCanMutate, () => moreOptions.click());
      const saveMenuItem = await this.firstVisible(page.locator(this.selectors.saveMenuItem), 5000);
      if (!saveMenuItem) throw new Error("Blogger draft Save menu item was not detected");
      const saved = await clickDraftSaveButtonWithGuard(saveMenuItem, input.assertCanMutate);
      if (!saved) throw new Error("Blogger draft Save menu item is disabled after image insertion");
      await page.waitForTimeout(2000);
      await page.goto(input.postEditorUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertSessionReady(page, input.artifactDir);
      await this.assertEditorIdentity(page, input.artifactDir, input.adminUrl, input.postEditorUrl);
      await this.assertExistingDraftStatus(page);
      const persistedImageCount = await page.locator(this.selectors.insertedImage).count();
      if (persistedImageCount !== 1) {
        throw new Error(
          `Existing draft image update did not persist exactly one image, found ${persistedImageCount}`
        );
      }
      const screenshotPath = await this.capture(
        page,
        input.artifactDir,
        "existing-draft-image-updated.png"
      );
      return {
        screenshotPath,
        currentUrl: sanitizeRequestUrl(page.url()),
        savedAt: new Date().toISOString(),
        imageUpload,
        preImageCount
      };
    } finally {
      await context.close();
    }
  }
  async inspectScheduleConfirmation(input: {
    adminUrl: string;
    postEditorUrl?: string;
    article: ArticleInput;
    artifactDir: string;
  }): Promise<ScheduleConfirmationInspectionResult> {
    if (
      !this.config.ENABLE_DRY_RUN ||
      this.config.ENABLE_DRAFT_SAVE ||
      this.config.ENABLE_SCHEDULED_POST
    ) {
      throw new Error("Schedule confirmation inspection requires dry-run-only flags");
    }
    if (!input.article.scheduledAt) {
      throw new Error("Schedule confirmation inspection requires scheduledAt");
    }
    const context = await this.openContext();
    try {
      const page = await context.newPage();
      const networkGuard = await installDryRunNetworkGuard(page);
      await page.goto(input.postEditorUrl ?? input.adminUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.assertSessionReady(page, input.artifactDir);
      await this.openPostEditorIfNeeded(page, input.artifactDir, input.article.title);
      await this.assertEditorIdentity(page, input.artifactDir, input.adminUrl, input.postEditorUrl);
      await this.fillArticle(page, input.article, input.artifactDir);
      const publish = await this.firstVisible(page.locator(this.selectors.publishButton), 10000);
      if (!publish) throw new Error("Blogger Publish button was not detected for inspection");
      await publish.click();
      await page.waitForTimeout(1000);
      const dialogTexts = (await page.locator('[role="dialog"]').allTextContents())
        .map((value) => value.trim())
        .filter(Boolean);
      const visibleButtonTexts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map((element) => (element.textContent ?? "").trim())
          .filter(Boolean)
      );
      const diagnostic = await this.writeDiagnostic(
        page,
        input.artifactDir,
        "schedule-confirmation-inspection"
      );
      return {
        currentUrl: sanitizeRequestUrl(page.url()),
        dialogTexts,
        visibleButtonTexts,
        ...diagnostic,
        networkGuard: networkGuard.snapshot()
      };
    } finally {
      await context.close();
    }
  }
  private async openContext(): Promise<BrowserContext> {
    return launchChromePersistentContext(this.config);
  }

  private async assertPersistedDraftBeforeScheduling(input: {
    adminUrl: string;
    postEditorUrl?: string;
    article: ArticleInput;
  }): Promise<void> {
    if (!input.postEditorUrl) {
      throw new Error("Scheduled post requires an existing persisted draft editor URL");
    }
    const postId = extractBloggerPostId(input.postEditorUrl);
    if (!postId) throw new Error("Scheduled post requires an exact Blogger draft post ID");
    // inspectExistingDraft opens and closes a separate browser context. This is
    // intentionally performed before the publish mutation is even prepared.
    const actual = await this.inspectExistingDraft({
      adminUrl: input.adminUrl,
      postEditorUrl: input.postEditorUrl
    });
    const persistence = evaluatePersistedDraft({
      expectedBlogId: extractBloggerBlogId(input.adminUrl),
      expectedPostId: postId,
      expectedEditUrl: input.postEditorUrl,
      article: input.article,
      actual
    });
    if (persistence.status !== "PASS") {
      throw new Error(
        `Scheduled post preflight refused persisted draft: ${persistence.reasons.join("; ")}`
      );
    }
  }

  private async openPostEditorIfNeeded(
    page: Page,
    artifactDir: string,
    articleTitle: string,
    assertCanMutate?: () => Promise<void>
  ): Promise<void> {
    if (await this.firstEditable(page.locator(this.selectors.titleInput), 8000)) {
      return;
    }

    const matchingDrafts = page.getByText(articleTitle, { exact: true });
    const editUrls = new Set<string>();
    const matchCount = await matchingDrafts.count();
    for (let index = 0; index < matchCount; index += 1) {
      const match = matchingDrafts.nth(index);
      if (!(await match.isVisible().catch(() => false))) continue;
      const link = match
        .locator(
          'xpath=ancestor::*[.//a[contains(@href, "/blog/post/edit/")]][1]//a[contains(@href, "/blog/post/edit/")]'
        )
        .first();
      const href = await link.getAttribute("href").catch(() => null);
      const editPath = href?.match(/\/blog\/post\/edit\/\d+\/\d+/)?.[0];
      if (editPath) editUrls.add(new URL(editPath, page.url()).toString());
    }
    if (editUrls.size > 1) {
      const diagnostic = await this.writeDiagnostic(page, artifactDir, "duplicate-drafts-detected");
      throw new Error(
        `Duplicate Blogger drafts detected for title "${articleTitle}": ${[...editUrls].join(", ")}. Diagnostic screenshot: ${diagnostic.screenshotPath}. HTML: ${diagnostic.htmlPath}`
      );
    }
    if (editUrls.size === 1) {
      await page.goto([...editUrls][0], { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      if (await this.firstEditable(page.locator(this.selectors.titleInput), 5000)) return;
    }

    const newPost = await this.firstVisible(page.locator(this.selectors.newPostButton), 15000);
    if (!newPost) {
      const diagnostic = await this.writeDiagnostic(page, artifactDir, "new-post-button-not-found");
      throw new Error(
        `Blogger New Post button was not detected. Current URL: ${page.url()}. Diagnostic screenshot: ${diagnostic.screenshotPath}. HTML: ${diagnostic.htmlPath}`
      );
    }

    const beforeUrl = page.url();
    await performDraftMutationWithGuard(assertCanMutate, () => newPost.click());
    await Promise.race([
      page
        .waitForURL((url) => url.toString() !== beforeUrl, { timeout: 15000 })
        .catch(() => undefined),
      page
        .locator(this.selectors.titleInput)
        .first()
        .waitFor({ state: "visible", timeout: 15000 })
        .catch(() => undefined)
    ]);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

    if (!(await this.firstEditable(page.locator(this.selectors.titleInput), 5000))) {
      const currentUrl = page.url();
      if (/\/blog\/post\/edit\/\d+\/\d+/.test(currentUrl)) {
        await page.goto(currentUrl, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      }
    }

    if (!(await this.firstEditable(page.locator(this.selectors.titleInput), 5000))) {
      const diagnostic = await this.writeDiagnostic(
        page,
        artifactDir,
        "new-post-click-did-not-open-editor"
      );
      throw new Error(
        `Blogger New Post button was clicked, but the editor did not open. Current URL: ${page.url()}. Diagnostic screenshot: ${diagnostic.screenshotPath}. HTML: ${diagnostic.htmlPath}`
      );
    }
  }

  private async fillArticle(
    page: Page,
    article: ArticleInput,
    artifactDir: string,
    assertCanMutate?: () => Promise<void>
  ): Promise<{ postSettings: PostSettingsResult; schedulePreview?: SchedulePreviewValue }> {
    const titleInput = await this.firstEditable(page.locator(this.selectors.titleInput), 20000);
    if (!titleInput) {
      const diagnostic = await this.writeDiagnostic(page, artifactDir, "editor-not-found");
      throw new Error(
        `Blogger post editor was not detected. Current URL: ${page.url()}. Diagnostic screenshot: ${diagnostic.screenshotPath}. HTML: ${diagnostic.htmlPath}`
      );
    }

    await performDraftMutationWithGuard(assertCanMutate, () => titleInput.fill(article.title));
    validateDraftTitle(await titleInput.inputValue(), article.title);

    if (this.selectors.htmlEditorToggle) {
      const toggle = await this.firstVisible(page.locator(this.selectors.htmlEditorToggle));
      if (toggle) {
        await performDraftMutationWithGuard(assertCanMutate, () => toggle.click());
      }
    } else {
      await this.ensureHtmlEditorView(page, assertCanMutate);
    }

    const body = await this.firstVisible(page.locator(this.selectors.bodyEditable), 20000);
    if (body) {
      await performDraftMutationWithGuard(assertCanMutate, async () => {
        await body.click();
        await body.fill(article.html).catch(async () => {
          await page.keyboard.insertText(article.html);
        });
      });
    } else {
      const filled = await performDraftMutationWithGuard(assertCanMutate, () =>
        this.fillCodeMirrorOrHiddenTextarea(page, article.html)
      );
      if (!filled) {
        const diagnostic = await this.writeDiagnostic(page, artifactDir, "body-editor-not-found");
        throw new Error(
          `Blogger body editor was not detected. Diagnostic screenshot: ${diagnostic.screenshotPath}. HTML: ${diagnostic.htmlPath}`
        );
      }
    }

    await assertCanMutate?.();
    const postSettings = await new BloggerPostSettings(this.selectors).apply(
      page,
      article,
      assertCanMutate
    );
    if (article.scheduledAt) await assertCanMutate?.();
    const schedulePreview = article.scheduledAt
      ? await new BloggerSchedulePreview(this.selectors, this.config.APP_TIMEZONE).apply(
          page,
          article.scheduledAt,
          assertCanMutate
        )
      : undefined;
    return { postSettings, schedulePreview };
  }
  private async ensureHtmlEditorView(
    page: Page,
    assertCanMutate?: () => Promise<void>
  ): Promise<void> {
    const selectedHtml = await this.firstVisible(
      page.locator('[data-value="html"][role="option"][aria-selected="true"]'),
      500
    );
    if (selectedHtml) return;

    const viewMode = await this.firstVisible(page.locator(this.selectors.viewModeListbox), 5000);
    if (!viewMode) return;
    await performDraftMutationWithGuard(assertCanMutate, () => viewMode.click());
    await page.waitForTimeout(250);
    // The menu is duplicated in Blogger's DOM. While Compose is selected, the
    // actionable HTML option is the unselected copy; force-click it because
    // the menu's visibility transition is not reflected consistently.
    const htmlOption = page
      .locator('[data-value="html"][role="option"][aria-selected="false"]')
      .first();
    if ((await htmlOption.count()) === 0) {
      throw new Error("Blogger HTML editor view option was not detected");
    }
    await performDraftMutationWithGuard(assertCanMutate, () => htmlOption.click({ force: true }));
    await page.waitForTimeout(300);
  }
  private async fillCodeMirrorOrHiddenTextarea(page: Page, html: string): Promise<boolean> {
    return page.evaluate((value) => {
      const codeMirrorHost = document.querySelector(".CodeMirror") as
        | (HTMLElement & {
            CodeMirror?: { setValue: (value: string) => void; refresh: () => void };
          })
        | null;

      if (codeMirrorHost?.CodeMirror) {
        codeMirrorHost.CodeMirror.setValue(value);
        codeMirrorHost.CodeMirror.refresh();
        codeMirrorHost.dispatchEvent(new Event("input", { bubbles: true }));
        codeMirrorHost.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      const textarea = document.querySelector(
        'textarea[jsname="bqeLof"]'
      ) as HTMLTextAreaElement | null;
      if (textarea) {
        textarea.value = value;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      return false;
    }, html);
  }

  private async readDraftHtml(page: Page): Promise<string> {
    for (const frame of page.frames()) {
      const value = await frame
        .evaluate(() => {
          const codeMirrorHost = document.querySelector(".CodeMirror") as
            (HTMLElement & { CodeMirror?: { getValue: () => string } }) | null;
          if (codeMirrorHost?.CodeMirror) return codeMirrorHost.CodeMirror.getValue();

          const textarea = document.querySelector(
            'textarea[jsname="bqeLof"], textarea.Fdco1c'
          ) as HTMLTextAreaElement | null;
          if (textarea?.value.trim()) return textarea.value;

          return (
            [...document.querySelectorAll<HTMLElement>('[contenteditable="true"]')]
              .map((element) => element.innerHTML)
              .sort((left, right) => right.length - left.length)[0] ?? ""
          );
        })
        .catch(() => "");
      if (value.trim()) return value;
    }
    throw new Error("Blogger existing draft body was not detected");
  }

  private async countDraftImages(page: Page): Promise<number> {
    let count = 0;
    for (const frame of page.frames()) {
      const isMainFrame = frame === page.mainFrame();
      count += await frame
        .evaluate((mainFrame) => {
          const rendered = document.querySelectorAll('[contenteditable="true"] img').length;
          const iframeRendered = document.querySelectorAll(
            'img[src*="blogger.googleusercontent.com"]'
          ).length;
          const textareaMarkup = Array.from(document.querySelectorAll("textarea"))
            .map((element) => (element as HTMLTextAreaElement).value)
            .join("\n");
          const codeMirrorHost = document.querySelector(".CodeMirror") as
            (HTMLElement & { CodeMirror?: { getValue: () => string } }) | null;
          const source = codeMirrorHost?.CodeMirror?.getValue() ?? textareaMarkup;
          const sourceImages = source.match(/<img\b/gi)?.length ?? 0;
          return Math.max(rendered, mainFrame ? 0 : iframeRendered, sourceImages);
        }, isMainFrame)
        .catch(() => 0);
    }
    return count;
  }

  private async readInputValue(page: Page, selector: string): Promise<string> {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const value = await locator
        .nth(index)
        .inputValue()
        .catch(() => "");
      if (value.trim()) return value;
    }
    return "";
  }

  private async readPublishActionText(publish: Locator | null): Promise<string> {
    if (!publish) return "";
    const [text, label, tooltip] = await Promise.all([
      publish.innerText().catch(() => ""),
      publish.getAttribute("aria-label").catch(() => null),
      publish.getAttribute("data-tooltip").catch(() => null)
    ]);
    return [text, label, tooltip]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" ");
  }

  private detectPostState(input: {
    publishText: string;
    publishVisible: boolean;
    scheduledDate: string;
    scheduledTime: string;
  }): ExistingDraftInspection["postState"] {
    // Blogger exposes the same visible action through text, aria-label, and a
    // tooltip.  readPublishActionText deliberately retains all three, so a
    // Japanese draft can be reported as "公開 公開" rather than just "公開".
    // The editable Publish action is authoritative even when stale schedule
    // inputs remain populated after a scheduled post is reverted to a draft.
    if (/(^|\s)(公開|Publish)(\s|$)/i.test(input.publishText.trim())) return "DRAFT";
    const date = input.scheduledDate.trim().replaceAll("-", "/");
    const hasScheduledDate =
      date.length > 0 &&
      !/^1970\/?0?1\/?0?1(?:\D|$)/.test(date) &&
      input.scheduledTime.trim().length > 0;
    if (hasScheduledDate) return "SCHEDULED";
    if (/更新|Update/i.test(input.publishText)) return "PUBLISHED";
    return input.publishVisible ? "DRAFT" : "UNKNOWN";
  }

  private detectPostListState(rowText: string): BloggerPostListEntry["postState"] {
    if (/公開済み|Published/i.test(rowText)) return "PUBLISHED";
    if (/スケジュール済み|Scheduled/i.test(rowText)) return "SCHEDULED";
    if (/下書き|Draft/i.test(rowText)) return "DRAFT";
    return "UNKNOWN";
  }

  private async readPublishDateText(page: Page): Promise<string | undefined> {
    const button = await this.firstVisible(page.locator(this.selectors.scheduleButton), 1000);
    const text = (await button?.innerText().catch(() => ""))?.trim();
    const match = text?.match(/\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}/);
    return match?.[0];
  }

  private async firstVisible(locator: Locator, timeout = 1000): Promise<Locator | null> {
    await locator
      .first()
      .waitFor({ state: "attached", timeout })
      .catch(() => undefined);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }
    return null;
  }

  private async capturePermalinkUiSnapshot(
    page: Page,
    savedIndicator: Locator
  ): Promise<PermalinkUiSnapshot> {
    const input = page.locator(this.selectors.permalinkInput).first();
    const customOption = page.locator(this.selectors.customPermalinkOption).first();
    const permalinkButton = page.locator(this.selectors.permalinkButton).first();
    const regionText = await input
      .locator("xpath=ancestor::*[@role='region'][1]")
      .innerText()
      .catch(() => "");
    const previewUrl = regionText.match(/https:\/\/[^\s]+/)?.[0] ?? null;
    const focused = page.locator(":focus").first();
    return {
      inputValue: await input.inputValue().catch(() => ""),
      inputInitialValue: await input.getAttribute("data-initial-value").catch(() => null),
      customOptionChecked: await customOption.getAttribute("aria-checked").catch(() => null),
      permalinkExpanded: await permalinkButton.getAttribute("aria-expanded").catch(() => null),
      previewUrl,
      focusedAriaLabel: await focused.getAttribute("aria-label").catch(() => null),
      saveMenuVisible: Boolean(
        await page
          .locator(this.selectors.saveMenuItem)
          .first()
          .isVisible()
          .catch(() => false)
      ),
      savedIndicatorVisible: await savedIndicator.isVisible().catch(() => false)
    };
  }

  private async assertExistingDraftStatus(page: Page): Promise<void> {
    const publish = await this.firstVisible(page.locator(this.selectors.publishButton), 5000);
    if (!publish) {
      throw new Error("Configured existing post is not an editable Blogger draft");
    }
  }

  private async assertReadOnlySessionReady(page: Page): Promise<void> {
    const issue = detectBloggerSessionIssue({
      url: page.url(),
      bodyText: await page
        .locator("body")
        .innerText()
        .catch(() => ""),
      hasPasswordInput: (await page.locator('input[type="password"]').count()) > 0,
      hasCaptchaFrame: (await page.locator('iframe[src*="recaptcha"]').count()) > 0
    });
    if (issue) throw new Error(`Blogger session is not ready for read-only draft audit: ${issue}`);
  }

  private async firstEditable(locator: Locator, timeout = 1000): Promise<Locator | null> {
    await locator
      .first()
      .waitFor({ state: "attached", timeout })
      .catch(() => undefined);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      const usable = await candidate
        .evaluate((element) => {
          const input = element as HTMLInputElement | HTMLTextAreaElement;
          return (
            !input.disabled && !input.readOnly && element.getAttribute("aria-hidden") !== "true"
          );
        })
        .catch(() => false);
      if (
        usable &&
        (await candidate.isVisible().catch(() => false)) &&
        (await candidate.isEditable().catch(() => false))
      ) {
        return candidate;
      }
    }
    return null;
  }

  private async assertEditorIdentity(
    page: Page,
    artifactDir: string,
    adminUrl: string,
    postEditorUrl?: string
  ): Promise<void> {
    try {
      validateBloggerEditorIdentity({ adminUrl, postEditorUrl, currentUrl: page.url() });
    } catch (error) {
      const diagnostic = await this.writeDiagnostic(page, artifactDir, "editor-identity-mismatch");
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}. Diagnostic screenshot: ${diagnostic.screenshotPath}. HTML: ${diagnostic.htmlPath}`
      );
    }
  }
  private async assertSessionReady(page: Page, artifactDir: string): Promise<void> {
    const signals = {
      url: page.url(),
      bodyText: await page
        .locator("body")
        .innerText({ timeout: 3000 })
        .catch(() => ""),
      hasPasswordInput: await page
        .locator('input[type="password"]')
        .first()
        .isVisible()
        .catch(() => false),
      hasCaptchaFrame:
        (await page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]').count()) > 0
    };
    const issue = detectBloggerSessionIssue(signals);
    if (!issue) return;
    const diagnostic = await this.writeDiagnostic(
      page,
      artifactDir,
      `session-${issue.toLowerCase().replaceAll("_", "-")}`
    );
    throw new Error(
      `Blogger session preflight failed: ${issue}. Diagnostic screenshot: ${diagnostic.screenshotPath}. HTML: ${diagnostic.htmlPath}`
    );
  }
  private async writeDiagnostic(
    page: Page,
    artifactDir: string,
    baseName: string
  ): Promise<{ screenshotPath: string; htmlPath: string }> {
    const screenshotPath = await this.capture(page, artifactDir, `${baseName}.png`);
    const htmlPath = path.join(artifactDir, `${baseName}.html`);
    await writeFile(htmlPath, await page.content(), "utf8");
    await Promise.all(
      page.frames().map(async (frame, index) => {
        if (frame === page.mainFrame()) return;
        const framePath = path.join(artifactDir, `${baseName}-frame-${index}.html`);
        const content = await frame.content().catch(() => "");
        if (content) await writeFile(framePath, content, "utf8");
      })
    );
    await Promise.all(
      page
        .context()
        .pages()
        .map(async (contextPage, pageIndex) => {
          if (contextPage === page) return;
          const pagePath = path.join(artifactDir, `${baseName}-page-${pageIndex}.html`);
          const content = await contextPage.content().catch(() => "");
          if (content) await writeFile(pagePath, content, "utf8");
          await Promise.all(
            contextPage.frames().map(async (frame, frameIndex) => {
              if (frame === contextPage.mainFrame()) return;
              const framePath = path.join(
                artifactDir,
                `${baseName}-page-${pageIndex}-frame-${frameIndex}.html`
              );
              const frameContent = await frame.content().catch(() => "");
              if (frameContent) await writeFile(framePath, frameContent, "utf8");
            })
          );
        })
    );
    return { screenshotPath, htmlPath };
  }

  private async capture(page: Page, artifactDir: string, fileName: string): Promise<string> {
    const screenshotsDir = path.join(artifactDir, "screenshots");
    await mkdir(screenshotsDir, { recursive: true });
    const screenshotPath = path.join(screenshotsDir, fileName);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  }
}
