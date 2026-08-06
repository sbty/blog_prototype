import type { Locator, Page } from "@playwright/test";
import type { BloggerSelectors } from "./bloggerSelectors.js";
import { validateImageFile } from "./imageFile.js";

export interface ImageUploadResult {
  sourcePath: string;
  sizeBytes: number;
  insertedImageCount: number;
  reusedExisting?: boolean;
}

export function requireImageMutationGuard(
  guard: (() => Promise<void>) | undefined
): asserts guard is () => Promise<void> {
  if (!guard) throw new Error("Image upload requires a mutation guard");
}

export async function performImageMutationWithGuard<T>(
  assertCanMutate: (() => Promise<void>) | undefined,
  mutation: () => Promise<T>
): Promise<T> {
  await assertCanMutate?.();
  return mutation();
}

export class BloggerImageUploader {
  constructor(private readonly selectors: BloggerSelectors) {}

  async upload(
    page: Page,
    imagePath: string,
    assertCanMutate: () => Promise<void>
  ): Promise<ImageUploadResult> {
    requireImageMutationGuard(assertCanMutate);
    const image = await validateImageFile(imagePath);
    await this.ensureComposeView(page, assertCanMutate);
    const beforeCount = await this.countInsertedImages(page);
    if (beforeCount > 0) {
      return {
        sourcePath: image.absolutePath,
        sizeBytes: image.sizeBytes,
        insertedImageCount: beforeCount,
        reusedExisting: true
      };
    }
    const insertButton = await this.firstVisible(
      page.locator(this.selectors.insertImageButton),
      10000
    );
    if (!insertButton) {
      throw new Error("Blogger Insert image button was not detected");
    }
    await performImageMutationWithGuard(assertCanMutate, () => insertButton.click());

    const uploadItem = await this.firstVisible(
      page.locator(this.selectors.uploadFromComputerMenuItem),
      5000
    );
    if (!uploadItem) {
      throw new Error("Blogger Upload from computer menu item was not detected");
    }

    const uploadMenuItem = uploadItem
      .locator('xpath=ancestor-or-self::*[@role="menuitem"][1]')
      .first();
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null);
    await uploadMenuItem.focus();
    await performImageMutationWithGuard(assertCanMutate, () => uploadMenuItem.press("Enter"));
    const chooser = await chooserPromise;
    if (chooser) {
      await performImageMutationWithGuard(assertCanMutate, () => chooser.setFiles(image.absolutePath));
    } else {
      const fileInput = await this.waitForFileInput(page, 10000);
      if (fileInput) {
        await performImageMutationWithGuard(assertCanMutate, () => fileInput.setInputFiles(image.absolutePath));
      } else {
        const browse = await this.waitForVisibleTarget(
          page,
          this.selectors.imageBrowseButton,
          10000
        );
        if (!browse) throw new Error("Blogger image file input was not detected");
        const browseChooser = browse.ownerPage
          .waitForEvent("filechooser", { timeout: 5000 })
          .catch(() => null);
        await performImageMutationWithGuard(assertCanMutate, () => browse.locator.click());
        const selected = await browseChooser;
        if (!selected) throw new Error("Blogger image file chooser did not open");
        await performImageMutationWithGuard(assertCanMutate, () => selected.setFiles(image.absolutePath));
      }
    }
    const confirm = await this.firstVisibleAcrossFrames(
      page,
      this.selectors.imageInsertButton,
      15000
    );
    if (confirm && (await confirm.getAttribute("aria-disabled")) !== "true") {
      await performImageMutationWithGuard(assertCanMutate, () => confirm.click());
    }

    const insertedImageCount = await this.waitForInsertedImage(page, beforeCount, 30000);
    return { sourcePath: image.absolutePath, sizeBytes: image.sizeBytes, insertedImageCount };
  }

  private async ensureComposeView(
    page: Page,
    assertCanMutate?: () => Promise<void>
  ): Promise<void> {
    if (await this.firstVisible(page.locator(this.selectors.insertImageButton), 1000)) return;
    const selectedCompose = page.locator(
      `${this.selectors.composeViewOption}[aria-selected="true"]`
    );
    if ((await selectedCompose.count()) > 0) return;

    const listbox = await this.firstVisible(page.locator(this.selectors.viewModeListbox), 5000);
    if (!listbox) throw new Error("Blogger editor view selector was not detected");
    await performImageMutationWithGuard(assertCanMutate, () => listbox.click());
    const compose = page.locator(this.selectors.composeViewOption).last();
    await performImageMutationWithGuard(assertCanMutate, () => compose.click({ force: true }));
    await page.waitForTimeout(500);
  }
  private async waitForFileInput(page: Page, timeout: number): Promise<Locator | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const candidatePage of page.context().pages()) {
        for (const frame of candidatePage.frames()) {
          const input = frame.locator(this.selectors.imageFileInput).first();
          if ((await input.count()) > 0) return input;
        }
      }
      await page.waitForTimeout(250);
    }
    return null;
  }

  private async waitForVisibleTarget(
    page: Page,
    selector: string,
    timeout: number
  ): Promise<{ locator: Locator; ownerPage: Page } | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const candidatePage of page.context().pages()) {
        for (const frame of candidatePage.frames()) {
          const locator = await this.firstVisible(frame.locator(selector), 250);
          if (locator) return { locator, ownerPage: candidatePage };
        }
      }
      await page.waitForTimeout(250);
    }
    return null;
  }
  private async firstVisibleAcrossFrames(
    page: Page,
    selector: string,
    timeout: number
  ): Promise<Locator | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        const result = await this.firstVisible(frame.locator(selector), 250);
        if (result) return result;
      }
      await page.waitForTimeout(250);
    }
    return null;
  }

  private async countInsertedImages(page: Page): Promise<number> {
    let count = 0;
    for (const frame of page.frames()) {
      count += await frame
        .evaluate(() => {
          const rendered = document.querySelectorAll('[contenteditable="true"] img').length;
          const textareaMarkup = Array.from(document.querySelectorAll("textarea"))
            .map((element) => (element as HTMLTextAreaElement).value)
            .join("\n");
          const codeMirrorHost = document.querySelector(".CodeMirror") as
            (HTMLElement & { CodeMirror?: { getValue: () => string } }) | null;
          const source = codeMirrorHost?.CodeMirror?.getValue() ?? textareaMarkup;
          const sourceImages = source.match(/<img\b/gi)?.length ?? 0;
          return Math.max(rendered, sourceImages);
        })
        .catch(() => 0);
    }
    return count;
  }
  private async waitForInsertedImage(
    page: Page,
    beforeCount: number,
    timeout: number
  ): Promise<number> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const count = await this.countInsertedImages(page);
      if (count > beforeCount) return count;
      await page.waitForTimeout(250);
    }
    throw new Error("Blogger did not confirm that the image was inserted");
  }

  private async firstVisible(locator: Locator, timeout: number): Promise<Locator | null> {
    await locator
      .first()
      .waitFor({ state: "attached", timeout })
      .catch(() => undefined);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
    return null;
  }
}
