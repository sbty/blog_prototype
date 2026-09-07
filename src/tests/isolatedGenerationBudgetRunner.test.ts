import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("isolated generation total-budget runner", () => {
  const source = readFileSync(
    path.resolve("scripts/generate-isolated-articles-with-total-budget.mjs"),
    "utf8"
  );

  it("sums the guarded service estimates before any paid generation", () => {
    const aggregate = source.indexOf("item.preflight.estimate.maximumCostCents");
    const budgetCheck = source.indexOf("maximumPossibleCents > maximumCostCents");
    const execution = source.indexOf("await service.execute");

    expect(aggregate).toBeGreaterThan(0);
    expect(budgetCheck).toBeGreaterThan(aggregate);
    expect(execution).toBeGreaterThan(budgetCheck);
    expect(source).not.toContain("inputBytes * pricing");
  });

  it("creates no-overwrite attempt and response evidence before the provider call", () => {
    const responseReservation = source.indexOf('open(item.output.responsePath, "wx")');
    const attemptMarker = source.indexOf(".attempt.json");
    const execution = source.indexOf("await service.execute");

    expect(responseReservation).toBeGreaterThan(0);
    expect(attemptMarker).toBeGreaterThan(responseReservation);
    expect(execution).toBeGreaterThan(attemptMarker);
    expect(source).toContain('flag: "wx"');
  });
});
