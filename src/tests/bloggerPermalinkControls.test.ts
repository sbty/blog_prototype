import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { BloggerPostSettings } from "../browser/bloggerPostSettings.js";
import type { BloggerSelectors } from "../browser/bloggerSelectors.js";

describe("Blogger permalink controls", () => {
  const selectors = JSON.parse(
    readFileSync(path.resolve("config/blogger-selectors.json"), "utf8")
  ) as { customPermalinkOption: string; permalinkInput: string };
  const settings = readFileSync(path.resolve("src/browser/bloggerPostSettings.ts"), "utf8");
  const dryRun = readFileSync(path.resolve("src/browser/bloggerDryRun.ts"), "utf8");

  it("targets current Japanese and English custom-permalink radios without an obsolete jsname", () => {
    expect(selectors.customPermalinkOption).toContain('[data-value="2"]');
    expect(selectors.customPermalinkOption).toContain('[aria-label*="カスタム パーマリンク"]');
    expect(selectors.customPermalinkOption).not.toContain('jsname="kriai"');
  });

  it("accepts Blogger's current Japanese custom permalink input label", () => {
    expect(selectors.permalinkInput).toContain('[aria-label*="カスタム パーマリンク"]');
    expect(selectors.permalinkInput).not.toContain("jsname=");
  });

  it("fails closed before filling or saving when a scheduled editor exposes only its automatic preview", () => {
    const unavailable = settings.indexOf("Blogger custom permalink control is unavailable");
    const type = settings.indexOf("permalinkInput.type(normalized)");

    expect(unavailable).toBeGreaterThan(-1);
    expect(type).toBeGreaterThan(unavailable);
    expect(settings).toContain("automatic permalink preview");
  });

  it("commits the normal post-settings permalink through normal input and blur", () => {
    expect(settings).toContain('permalinkInput.press("Control+A")');
    expect(settings).toContain("permalinkInput.type(normalized)");
    expect(settings).toContain('permalinkInput.press("Tab")');
  });

  it("blurs the permalink input before a permalink-only Save", async () => {
    const press = vi.fn(async () => undefined);
    const permalinkInput = {
      click: vi.fn(async () => undefined),
      press,
      type: vi.fn(async () => undefined),
      inputValue: vi.fn(async () => "required-permalink"),
      count: vi.fn(async () => 1),
      isVisible: vi.fn(async () => true),
      isEditable: vi.fn(async () => true),
      first() {
        return this;
      },
      nth() {
        return this;
      },
      waitFor: vi.fn(async () => undefined)
    };
    const permalinkButton = {
      click: vi.fn(async () => undefined),
      count: vi.fn(async () => 1),
      isVisible: vi.fn(async () => true),
      first() {
        return this;
      },
      nth() {
        return this;
      },
      waitFor: vi.fn(async () => undefined)
    };
    const customOption = {
      getAttribute: vi.fn(async () => "true"),
      count: vi.fn(async () => 1),
      isVisible: vi.fn(async () => true),
      first() {
        return this;
      },
      nth() {
        return this;
      },
      waitFor: vi.fn(async () => undefined)
    };
    const page = {
      locator: (selector: string) =>
        ({
          permalinkButton,
          customOption,
          permalinkInput
        })[selector]
    } as unknown as Page;
    const selectors = {
      permalinkButton: "permalinkButton",
      customPermalinkOption: "customOption",
      permalinkInput: "permalinkInput"
    } as BloggerSelectors;

    await new BloggerPostSettings(selectors).applyCustomPermalinkOnly(page, "required-permalink");

    expect(press).toHaveBeenCalledWith("Control+A");
    expect(press).toHaveBeenCalledWith("Backspace");
    expect(press).toHaveBeenCalledWith("Tab");
  });

  it("waits for the blurred permalink preview before one keyboard Save activation", () => {
    const method = dryRun.slice(
      dryRun.indexOf("async updateExistingDraftPermalink"),
      dryRun.indexOf("async scheduleExistingDraftAt")
    );
    const observation = method.indexOf("saveNetworkObserver.run(async () =>");
    const edit = method.indexOf(".applyCustomPermalinkOnly(");
    const explicitSave = method.indexOf("pressDraftSaveMenuItemWithGuard(");

    expect(edit).toBeGreaterThan(-1);
    expect(observation).toBeLessThan(edit);
    expect(explicitSave).toBeGreaterThan(observation);
    expect(method).toContain("saveNetworkObserver?.markExplicitSaveClick()");
    expect(dryRun).toContain('await menuItem.press("Enter")');
    expect(method).toContain(
      "const previewCommit = waitForExpectedPermalinkPreview(page, expectedSlug)"
    );
    expect(method.indexOf("await previewCommit")).toBeLessThan(explicitSave);
    expect(method).not.toContain("blurAfterInput: false");
    expect(method).not.toContain("performDraftChangeWithRecognition({");
  });
});
