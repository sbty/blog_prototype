import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("publication monitor batch CLI", () => {
  const source = readFileSync(path.resolve("src/cli/operationalCli.ts"), "utf8");

  it("preflights monitor and schedule evidence before creating output", () => {
    const command = source.indexOf('if (args.command === "audit-publication-monitors")');
    const preflight = source.indexOf(
      "service.validatePreflight({ monitors: sources, canonicalItems })",
      command
    );
    const createOutput = source.indexOf("await mkdir(outputPath, { recursive: false })", command);
    expect(preflight).toBeGreaterThan(command);
    expect(createOutput).toBeGreaterThan(preflight);
  });

  it("writes a new report and contains no Blogger mutation command", () => {
    const command = source.slice(
      source.indexOf('if (args.command === "audit-publication-monitors")'),
      source.indexOf('if (args.command === "audit-existing-draft")')
    );
    expect(command).toContain('join(outputPath, "publication-monitor-batch-report.json")');
    expect(command).toContain('flag: "wx"');
    expect(command).not.toContain("saveDraft");
    expect(command).not.toContain("schedulePost");
  });
});
