import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("scheduled permalink recovery", () => {
  const browserClient = readFileSync(path.resolve("src/browser/bloggerDryRun.ts"), "utf8");
  const recoveryRunner = readFileSync(
    path.resolve("data/validate-one-draft-permalink-save.mjs"),
    "utf8"
  );
  const selectors = JSON.parse(
    readFileSync(path.resolve("config/blogger-selectors.json"), "utf8")
  ) as { revertToDraftMenuItem: string };

  const method = (name: string, next: string) => {
    const start = browserClient.indexOf(`async ${name}`);
    return browserClient.slice(start, browserClient.indexOf(`async ${next}`, start));
  };

  it("uses the explicit Japanese Revert to draft action for scheduled posts", () => {
    expect(selectors.revertToDraftMenuItem).toContain("下書きに戻す");
    expect(selectors.revertToDraftMenuItem).toContain('aria-label="下書きに戻す"');
    const revert = method("revertScheduledPostToDraft", "updateExistingDraftPermalink");

    expect(revert).toContain("ENABLE_SCHEDULED_POST=true and ENABLE_DRAFT_SAVE=false");
    expect(revert).toContain('page.getByRole("menuitem"');
    expect(revert).toContain("this.selectors.revertToDraftMenuItem");
    expect(revert).not.toContain("this.selectors.saveButton");
    expect(revert).not.toContain("fillArticle(");
  });

  it("splits draft-only permalink saving from schedule-only restoration", () => {
    const save = method("updateExistingDraftPermalink", "scheduleExistingDraftAt");
    const schedule = method("scheduleExistingDraftAt", "updateExistingDraftImage");

    expect(save).toContain("ENABLE_DRAFT_SAVE=true and ENABLE_SCHEDULED_POST=false");
    expect(save).toContain("applyCustomPermalinkOnly");
    expect(save).toContain('getByRole("menuitem", { name: /^(保存|Save)$/ })');
    expect(save).not.toContain("performDraftChangeWithRecognition");
    expect(save.indexOf("saveNetworkObserver.run")).toBeLessThan(
      save.indexOf("applyCustomPermalinkOnly")
    );
    expect(save.indexOf("applyCustomPermalinkOnly")).toBeLessThan(
      save.indexOf("pressDraftSaveMenuItemWithGuard")
    );
    expect(save).toContain(
      "const previewCommit = waitForExpectedPermalinkPreview(page, expectedSlug)"
    );
    expect(save.indexOf("await previewCommit")).toBeLessThan(
      save.indexOf("pressDraftSaveMenuItemWithGuard")
    );
    expect(save).not.toContain("blurAfterInput: false");
    expect(save).toContain("const beforeSaveClick = afterInput");
    expect(save).not.toContain("const previewDeadline");
    expect(save).not.toContain('permalinkButton.getAttribute("aria-expanded")');
    expect(save).toContain("waitForDraftSaveCompletion");
    expect(save).not.toContain("BloggerSchedulePreview");
    expect(schedule).toContain("ENABLE_SCHEDULED_POST=true and ENABLE_DRAFT_SAVE=false");
    expect(schedule).toContain("new BloggerSchedulePreview");
    expect(schedule).not.toContain("fillArticle(");
  });

  it("restores the reservation only after the fresh permalink audit passes", () => {
    const persistenceGate = recoveryRunner.indexOf('if (afterAudit.status !== "PASS"');
    const reschedule = recoveryRunner.indexOf("scheduledClient.scheduleExistingDraftAt");
    const rescheduleAudit = recoveryRunner.indexOf('evaluate(scheduled, slug, "SCHEDULED")');

    expect(persistenceGate).toBeGreaterThan(-1);
    expect(reschedule).toBeGreaterThan(persistenceGate);
    expect(rescheduleAudit).toBeGreaterThan(reschedule);
    expect(recoveryRunner).toContain('throw new Error("Post-reschedule audit failed")');
  });
});
