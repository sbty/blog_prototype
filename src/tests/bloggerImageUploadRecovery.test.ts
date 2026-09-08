import { readFileSync } from "node:fs";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { BloggerImageUploader } from "../browser/bloggerImageUploader.js";
import { loadBloggerSelectors } from "../browser/bloggerSelectors.js";
import { describe, expect, it } from "vitest";

describe("Blogger image upload recovery", () => {
  it("waits for a delayed visible option even when a hidden duplicate is already attached", async () => {
    let visible = false;
    const revealed = new Promise<void>((resolve) =>
      setTimeout(() => {
        visible = true;
        resolve();
      }, 10)
    );
    const hidden = { waitFor: async () => undefined, isVisible: async () => false };
    const option = {
      waitFor: async ({ state }: { state: string }) => {
        if (state === "visible") await revealed;
      },
      isVisible: async () => visible
    };
    const locator = {
      first: () => hidden,
      count: async () => 2,
      nth: (index: number) => (index === 0 ? hidden : option),
      filter: () => ({ first: () => option })
    } as unknown as Locator;
    const instance = new BloggerImageUploader(
      await loadBloggerSelectors("config/blogger-selectors.json")
    ) as unknown as {
      firstVisible(locator: Locator, timeout: number): Promise<unknown>;
    };
    expect(await instance.firstVisible(locator, 1000)).toBe(option);
    expect(visible).toBe(true);
  });

  const uploader = readFileSync(path.resolve("src/browser/bloggerImageUploader.ts"), "utf8");
  const browserClient = readFileSync(path.resolve("src/browser/bloggerDryRun.ts"), "utf8");
  const selectors = JSON.parse(
    readFileSync(path.resolve("config/blogger-selectors.json"), "utf8")
  ) as { uploadFromComputerMenuItem: string; saveMenuItem: string };

  it("opens the Japanese upload menu item by click before waiting for a Picker iframe input", () => {
    const click = uploader.indexOf("uploadItem.click()");
    const inputWait = uploader.indexOf("this.waitForFileInput(page, 20000)");

    expect(click).toBeGreaterThan(-1);
    expect(inputWait).toBeGreaterThan(click);
    expect(uploader).not.toContain('uploadMenuItem.press("Enter")');
    expect(uploader).toContain("for (const frame of candidatePage.frames())");
    expect(selectors.uploadFromComputerMenuItem).toContain("パソコンからアップロード");
  });

  it("scopes the mode control to the visible editor and verifies Compose mode", () => {
    const methodStart = uploader.indexOf("private async ensureComposeView");
    const method = uploader.slice(methodStart, uploader.indexOf("private async waitForFileInput"));

    expect(method).toContain("this.firstVisible(");
    expect(method).toContain('page.locator("[data-editmode]")');
    expect(method).toContain("activeEditor?.locator(this.selectors.viewModeListbox)");
    expect(method).not.toContain("selectedCompose.count()");
    expect(method).toContain("Blogger editor did not switch to Compose view");
  });

  it("uses the visible More options > Save route after image insertion without touching body text", () => {
    const methodStart = browserClient.indexOf("async updateExistingDraftImage");
    const method = browserClient.slice(
      methodStart,
      browserClient.indexOf("async inspectScheduleConfirmation", methodStart)
    );
    const moreOptions = method.indexOf("this.selectors.moreOptionsButton");
    const saveMenu = method.indexOf("this.selectors.saveMenuItem", moreOptions);

    expect(moreOptions).toBeGreaterThan(-1);
    expect(saveMenu).toBeGreaterThan(moreOptions);
    expect(method).not.toContain('editor.press("Space")');
    expect(method).not.toContain('editor.press("Backspace")');
    expect(selectors.saveMenuItem).toContain('has-text("保存")');
  });

  it("reapplies only labels after an image switches the editor to Compose view", () => {
    const methodStart = browserClient.indexOf("async saveDraft");
    const method = browserClient.slice(
      methodStart,
      browserClient.indexOf("async schedulePost", methodStart)
    );
    const upload = method.indexOf(
      "new BloggerImageUploader",
      method.indexOf("if (input.article.imagePath)")
    );
    const labels = method.indexOf(".reapplyLabelsAfterImage", upload);
    const save = method.indexOf("this.selectors.saveMenuItem", labels);

    expect(upload).toBeGreaterThan(-1);
    expect(labels).toBeGreaterThan(upload);
    expect(save).toBeGreaterThan(labels);
    expect(method.slice(upload, save)).not.toContain(".apply(");
  });

  it("reloads an image-only update and rejects any persisted image count other than one", () => {
    const methodStart = browserClient.indexOf("async updateExistingDraftImage");
    const method = browserClient.slice(
      methodStart,
      browserClient.indexOf("async inspectScheduleConfirmation", methodStart)
    );
    const save = method.indexOf("this.selectors.saveMenuItem");
    const reload = method.indexOf("await page.goto(input.postEditorUrl", save);
    const persistedCount = method.indexOf("persistedImageCount", reload);

    expect(reload).toBeGreaterThan(save);
    expect(persistedCount).toBeGreaterThan(reload);
    expect(method).toContain("Existing draft image update did not persist exactly one image");
  });
});
