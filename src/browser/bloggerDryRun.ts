import { chromium, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/env.js";
import type { ArticleInput } from "../domain/article.js";
import type { BloggerSelectors } from "./bloggerSelectors.js";
import { BloggerImageUploader, type ImageUploadResult } from "./bloggerImageUploader.js";
import { extractBloggerBlogId, validateBloggerEditorIdentity } from "./bloggerEditorIdentity.js";
import { BloggerPostSettings, type PostSettingsResult } from "./bloggerPostSettings.js";
import { BloggerSchedulePreview, type SchedulePreviewValue } from "./bloggerSchedulePreview.js";
import { detectBloggerSessionIssue } from "./bloggerSessionGuard.js";
import { getChromeProfilePath } from "./chromeProfile.js";
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

export async function clickDraftSaveButtonWithGuard(
  button: DraftSaveButton,
  assertCanMutate?: () => Promise<void>
): Promise<boolean> {
  if ((await button.getAttribute("aria-disabled")) === "true") return false;
  await assertCanMutate?.();
  await button.click();
  return true;
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
        const editPath = href?.match(/\/blog\/post\/edit\/\d+\/\d+/)?.[0];
        if (editPath) urls.add(new URL(editPath, page.url()).toString());
      }
      const editUrls = [...urls];
      return { title: input.title, editUrls, count: editUrls.length, rowTexts: [...rowTexts] };
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
      await input.assertCanMutate?.();
      const { postSettings, schedulePreview } = await this.fillArticle(
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
      const savedIndicator = page.locator(this.selectors.saveCompleteIndicator).first();
      const alreadySaved = await savedIndicator
        .waitFor({ state: "visible", timeout: 30000 })
        .then(() => true)
        .catch(() => false);
      if (!alreadySaved) {
        const saveButton = await this.firstVisible(page.locator(this.selectors.saveButton), 10000);
        if (!saveButton) {
          const diagnostic = await this.writeDiagnostic(
            page,
            input.artifactDir,
            "save-button-not-found"
          );
          throw new Error(
            `Blogger draft Save button was not detected. Diagnostic screenshot: ${diagnostic.screenshotPath}. HTML: ${diagnostic.htmlPath}`
          );
        }
        await clickDraftSaveButtonWithGuard(saveButton, async () => {
          await this.assertSessionReady(page, input.artifactDir);
          await this.assertEditorIdentity(
            page,
            input.artifactDir,
            input.adminUrl,
            input.postEditorUrl
          );
          await input.assertCanMutate?.();
        });
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
    const profilePath = getChromeProfilePath(this.config);
    await mkdir(profilePath, { recursive: true });

    return chromium.launchPersistentContext(profilePath, {
      headless: this.config.HEADLESS,
      executablePath: this.config.CHROME_EXECUTABLE_PATH || undefined,
      channel: this.config.CHROME_EXECUTABLE_PATH
        ? undefined
        : this.config.CHROME_CHANNEL || "chrome",
      locale: "ja-JP",
      timezoneId: this.config.APP_TIMEZONE,
      viewport: { width: 1920, height: 1080 }
    });
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
