import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/env.js";
import type { BloggerSelectors } from "./bloggerSelectors.js";
import { getChromeProfilePath } from "./chromeProfile.js";
import { validateBloggerEditorIdentity } from "./bloggerEditorIdentity.js";

export interface DraftSourceUpdateTarget {
  blogKey: string;
  slug: string;
  title: string;
  adminUrl: string;
  postEditorUrl: string;
  sourceSectionHtml: string;
  sourceUrls: string[];
}

export interface DraftSourceUpdateItemResult {
  blogKey: string;
  slug: string;
  status: "SAVED" | "ALREADY_PRESENT";
  sourceCount: number;
  titlePreserved: true;
  imagePreserved: true;
  beforeLength: number;
  afterLength: number;
  screenshotPath: string;
}

export interface PreparedOfficialSourcesHtml {
  html: string;
  changed: boolean;
}

function officialSectionCount(html: string): number {
  return (html.match(/class=["']official-sources["']/g) ?? []).length;
}

export function bloggerHostedImageCount(html: string): number {
  let count = 0;
  for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
    try {
      if (new URL(match[2]).hostname === "blogger.googleusercontent.com") count += 1;
    } catch {
      // Invalid image URLs do not count as preserved Blogger-hosted images.
    }
  }
  return count;
}

export function prepareOfficialSourcesHtml(
  currentHtml: string,
  sourceSectionHtml: string,
  sourceUrls: string[]
): PreparedOfficialSourcesHtml {
  if (!sourceSectionHtml.includes('class="official-sources"')) {
    throw new Error("Source section must use the official-sources class");
  }
  if (!sourceUrls.every((url) => sourceSectionHtml.includes(new URL(url).href))) {
    throw new Error("Source section must cite every provenance URL");
  }

  if (officialSectionCount(currentHtml) > 0) {
    const articleEnd = currentHtml.lastIndexOf("</article>");
    const candidate =
      articleEnd >= 0 ? currentHtml.slice(0, articleEnd + "</article>".length) : currentHtml;
    if (
      officialSectionCount(candidate) !== 1 ||
      !sourceUrls.every((url) => candidate.includes(new URL(url).href))
    ) {
      throw new Error("Existing official source section does not match provenance");
    }
    return { html: candidate, changed: candidate !== currentHtml };
  }

  const closing = currentHtml.match(/<\/article\s*>\s*$/i);
  if (!closing || closing.index === undefined) {
    return { html: `${currentHtml}${sourceSectionHtml}`, changed: true };
  }
  return {
    html: `${currentHtml.slice(0, closing.index)}${sourceSectionHtml}${currentHtml.slice(closing.index)}`,
    changed: true
  };
}

interface PreparedTarget {
  target: DraftSourceUpdateTarget;
  beforeHtml: string;
  expectedHtml: string;
  changed: boolean;
}

export class BloggerDraftSourceUpdater {
  constructor(
    private readonly config: AppConfig,
    private readonly selectors: BloggerSelectors
  ) {}

  async execute(
    targets: DraftSourceUpdateTarget[],
    artifactDir: string,
    assertCanMutate: () => Promise<void>
  ): Promise<DraftSourceUpdateItemResult[]> {
    if (!this.config.ENABLE_DRAFT_SAVE || this.config.ENABLE_SCHEDULED_POST) {
      throw new Error(
        "Draft source update requires ENABLE_DRAFT_SAVE=true and ENABLE_SCHEDULED_POST=false"
      );
    }
    const context = await this.openContext();
    const page = context.pages()[0] ?? (await context.newPage());
    try {
      const prepared: PreparedTarget[] = [];
      for (const target of targets) {
        const beforeHtml = await this.inspect(page, target);
        const expected = prepareOfficialSourcesHtml(
          beforeHtml,
          target.sourceSectionHtml,
          target.sourceUrls
        );
        prepared.push({
          target,
          beforeHtml,
          expectedHtml: expected.html,
          changed: expected.changed
        });
      }

      const results: DraftSourceUpdateItemResult[] = [];
      for (const item of prepared) {
        const { target, beforeHtml, expectedHtml, changed } = item;
        if (changed) {
          const currentHtml = await this.inspect(page, target);
          if (currentHtml !== beforeHtml) {
            throw new Error(
              `Blogger draft changed after preflight: ${target.blogKey}/${target.slug}`
            );
          }
          await assertCanMutate();
          const updated = await page.evaluate((html) => {
            const host = document.querySelector(".CodeMirror") as
              | (HTMLElement & {
                  CodeMirror?: { setValue: (value: string) => void; refresh: () => void };
                })
              | null;
            if (!host?.CodeMirror) return false;
            host.CodeMirror.setValue(html);
            host.CodeMirror.refresh();
            host.dispatchEvent(new Event("input", { bubbles: true }));
            host.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }, expectedHtml);
          if (!updated) throw new Error(`Blogger HTML editor was not detected: ${target.slug}`);

          await assertCanMutate();
          await page.locator(this.selectors.moreOptionsButton).click();
          const save = page.locator(this.selectors.saveMenuItem).first();
          await save.waitFor({ state: "visible", timeout: 10000 });
          await save.click();
          await page.waitForTimeout(7000);
        }

        const verifiedHtml = await this.inspect(page, target, true);
        if (
          officialSectionCount(verifiedHtml) !== 1 ||
          !target.sourceUrls.every((url) => verifiedHtml.includes(new URL(url).href))
        ) {
          throw new Error(`Blogger source reload verification failed: ${target.slug}`);
        }
        if (bloggerHostedImageCount(beforeHtml) !== bloggerHostedImageCount(verifiedHtml)) {
          throw new Error(`Blogger image preservation check failed: ${target.slug}`);
        }
        const screenshotPath = path.join(artifactDir, "screenshots", `${target.slug}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        results.push({
          blogKey: target.blogKey,
          slug: target.slug,
          status: changed ? "SAVED" : "ALREADY_PRESENT",
          sourceCount: target.sourceUrls.length,
          titlePreserved: true,
          imagePreserved: true,
          beforeLength: beforeHtml.length,
          afterLength: verifiedHtml.length,
          screenshotPath
        });
      }
      return results;
    } finally {
      await context.close();
    }
  }

  private async inspect(
    page: Page,
    target: DraftSourceUpdateTarget,
    reload = false
  ): Promise<string> {
    if (reload && page.url() === target.postEditorUrl) {
      await page.reload({ waitUntil: "domcontentloaded" });
    } else {
      await page.goto(target.postEditorUrl, { waitUntil: "domcontentloaded" });
    }
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    const title = page.locator(this.selectors.titleInput).first();
    await title.waitFor({ state: "visible", timeout: 20000 });
    if ((await title.inputValue()).trim() !== target.title.trim()) {
      throw new Error(`Blogger draft title mismatch: ${target.blogKey}/${target.slug}`);
    }
    validateBloggerEditorIdentity({
      adminUrl: target.adminUrl,
      postEditorUrl: target.postEditorUrl,
      currentUrl: page.url()
    });
    const html = await page.evaluate(() => {
      const host = document.querySelector(".CodeMirror") as
        (HTMLElement & { CodeMirror?: { getValue: () => string } }) | null;
      const textarea = document.querySelector(
        'textarea[jsname="bqeLof"]'
      ) as HTMLTextAreaElement | null;
      return host?.CodeMirror?.getValue() ?? textarea?.value;
    });
    if (!html) throw new Error(`Blogger draft HTML was not detected: ${target.slug}`);
    return html;
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
}
