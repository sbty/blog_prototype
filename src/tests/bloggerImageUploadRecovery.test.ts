import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Blogger image upload recovery", () => {
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

  it("reapplies metadata after an image switches the editor to Compose view before saving a draft", () => {
    const methodStart = browserClient.indexOf("async saveDraft");
    const method = browserClient.slice(
      methodStart,
      browserClient.indexOf("async schedulePost", methodStart)
    );
    const upload = method.indexOf(
      "new BloggerImageUploader",
      method.indexOf("if (input.article.imagePath)")
    );
    const metadata = method.indexOf("new BloggerPostSettings(this.selectors).apply", upload);
    const save = method.indexOf("this.selectors.saveMenuItem", metadata);

    expect(upload).toBeGreaterThan(-1);
    expect(metadata).toBeGreaterThan(upload);
    expect(save).toBeGreaterThan(metadata);
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
