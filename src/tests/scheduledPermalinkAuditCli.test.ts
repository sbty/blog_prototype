import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("scheduled permalink read-only CLI", () => {
  const source = readFileSync(path.resolve("src/cli/operationalCli.ts"), "utf8");

  function commandBlock(command: string, nextCommand: string): string {
    const start = source.indexOf(`if (args.command === "${command}")`);
    const end = source.indexOf(`if (args.command === "${nextCommand}")`, start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("finishes initial target preflight before creating the output directory", () => {
    const command = commandBlock(
      "audit-scheduled-permalinks",
      "reaudit-scheduled-permalink-unverified"
    );
    expect(command.indexOf("service.validatePreflight(targets)")).toBeLessThan(
      command.indexOf("await mkdir(outputPath, { recursive: false })")
    );
    expect(command).toContain('flag: "wx"');
  });

  it("re-audits only prior UNVERIFIED items after target preflight", () => {
    const command = commandBlock(
      "reaudit-scheduled-permalink-unverified",
      "prepare-scheduled-permalink-repair"
    );
    expect(command).toContain('.filter((item) => item.status === "UNVERIFIED")');
    expect(command.indexOf("service.validatePreflight(targets)")).toBeLessThan(
      command.indexOf("await mkdir(outputPath, { recursive: false })")
    );
    expect(command).toContain('flag: "wx"');
  });

  it("validates the approval-only package before creating output and never mutates Blogger", () => {
    const command = commandBlock(
      "prepare-scheduled-permalink-repair",
      "audit-publication-monitors"
    );
    expect(command.indexOf("ScheduledPermalinkRepairPreparationService().prepare(")).toBeLessThan(
      command.indexOf("await mkdir(outputPath, { recursive: false })")
    );
    expect(command).toContain('flag: "wx"');
    expect(command).not.toContain("updateExistingDraftPermalink");
    expect(command).not.toContain("saveDraft");
    expect(command).not.toContain("schedulePost");
    expect(command).not.toContain("publishPost");
  });
});
