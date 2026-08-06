import { describe, expect, it } from "vitest";
import { assertValidJobTransition } from "../domain/job.js";

describe("job state transitions", () => {
  it("allows each mode to reach only its own completion state", () => {
    expect(() => assertValidJobTransition("dry-run", "RUNNING", "DRY_RUN_DONE")).not.toThrow();
    expect(() => assertValidJobTransition("draft", "RUNNING", "DRAFT_SAVED")).not.toThrow();
    expect(() => assertValidJobTransition("schedule", "RUNNING", "READY_FOR_POST")).not.toThrow();
  });

  it("rejects skipping schedule approval stages", () => {
    expect(() =>
      assertValidJobTransition("schedule", "READY_FOR_POST", "PREVIEW_CONFIRMED")
    ).toThrow("Invalid schedule job transition");
  });

  it("rejects cross-mode completion statuses", () => {
    expect(() => assertValidJobTransition("dry-run", "RUNNING", "DRAFT_SAVED")).toThrow();
    expect(() => assertValidJobTransition("draft", "RUNNING", "READY_FOR_POST")).toThrow();
  });

  it("rejects transitions out of terminal states", () => {
    expect(() => assertValidJobTransition("schedule", "CANCELLED", "RUNNING")).toThrow();
    expect(() => assertValidJobTransition("draft", "DRAFT_SAVED", "RUNNING")).toThrow();
  });
});