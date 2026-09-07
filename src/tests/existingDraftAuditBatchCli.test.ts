import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("existing draft audit batch CLI", () => {
  const source = readFileSync(path.resolve("src/cli/operationalCli.ts"), "utf8");

  it("creates a new output directory only after the complete input preflight", () => {
    const command = source.indexOf('if (args.command === "audit-existing-draft-batch")');
    const preflight = source.indexOf("service.validatePreflight(items)", command);
    const createOutput = source.indexOf("await mkdir(outputPath, { recursive: false })", command);

    expect(preflight).toBeGreaterThan(command);
    expect(createOutput).toBeGreaterThan(preflight);
  });

  it("writes individual reports and a summary without a Blogger mutation command", () => {
    const command = source.slice(
      source.indexOf('if (args.command === "audit-existing-draft-batch")'),
      source.indexOf('if (args.command === "prepare-article-queue")')
    );

    expect(command).toContain('join(outputPath, "summary.json")');
    expect(command).toContain('flag: "wx"');
    expect(command).not.toContain("saveDraft");
    expect(command).not.toContain("schedulePost");
  });

  it("writes a selection report and only emits a batch manifest when targets exist", () => {
    const command = source.slice(
      source.indexOf('if (args.command === "select-existing-draft-audit-targets")'),
      source.indexOf('if (args.command === "prepare-article-queue")')
    );
    expect(command).toContain('join(outputPath, "selection-report.json")');
    expect(command).toContain("if (report.auditManifest)");
    expect(command).not.toContain("audit-existing-draft-batch");
    expect(command).not.toContain("saveDraft");
    expect(command).not.toContain("schedulePost");
  });
});
