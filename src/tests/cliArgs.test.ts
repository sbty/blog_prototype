import { describe, expect, it } from "vitest";
import { commandRequiresDatabase, parseArgs } from "../cli/args.js";

describe("parseArgs", () => {
  it("defaults to help", () => {
    expect(parseArgs([])).toEqual({ command: "help", options: {} });
  });

  it("parses a batch manifest command", () => {
    expect(parseArgs(["run-batch", "--manifest", "batch.json"])).toEqual({
      command: "run-batch",
      options: { manifest: "batch.json" }
    });
  });
  it("parses a schedule batch manifest command", () => {
    expect(parseArgs(["run-schedule-batch", "--manifest", "schedule-batch.json"])).toEqual({
      command: "run-schedule-batch",
      options: { manifest: "schedule-batch.json" }
    });
  });
  it("parses a campaign preparation command", () => {
    expect(parseArgs(["prepare-campaign", "--manifest", "campaign.json"])).toEqual({
      command: "prepare-campaign",
      options: { manifest: "campaign.json" }
    });
  });
  it("parses a campaign inspection command", () => {
    expect(parseArgs(["inspect-campaign", "--campaign", "schedule-campaign-1"])).toEqual({
      command: "inspect-campaign",
      options: { campaign: "schedule-campaign-1" }
    });
  });
  it("parses the campaign list command without options", () => {
    expect(parseArgs(["list-campaigns"])).toEqual({
      command: "list-campaigns",
      options: {}
    });
  });
  it("parses valid command options in any order", () => {
    expect(
      parseArgs([
        "confirm-schedule-preview",
        "--preview-sha",
        "abc123",
        "--job",
        "job-1",
        "--confirm",
        "job-1"
      ])
    ).toEqual({
      command: "confirm-schedule-preview",
      options: { "preview-sha": "abc123", job: "job-1", confirm: "job-1" }
    });
  });

  it("parses the fail-closed execution boundary command", () => {
    expect(
      parseArgs([
        "execute-schedule",
        "--job",
        "job-1",
        "--confirm",
        "job-1",
        "--package-sha",
        "a".repeat(64),
        "--audit-sha",
        "b".repeat(64)
      ])
    ).toEqual({
      command: "execute-schedule",
      options: {
        job: "job-1",
        confirm: "job-1",
        "package-sha": "a".repeat(64),
        "audit-sha": "b".repeat(64)
      }
    });
  });
  it("rejects an execution confirmation that does not match the job ID", () => {
    expect(() =>
      parseArgs([
        "execute-schedule",
        "--job",
        "job-1",
        "--confirm",
        "job-2",
        "--package-sha",
        "a".repeat(64),
        "--audit-sha",
        "b".repeat(64)
      ])
    ).toThrow("exactly match the job ID");
  });
  it.each(["package-sha", "audit-sha"])("rejects an invalid execution %s", (invalidKey) => {
    const values = {
      "package-sha": "a".repeat(64),
      "audit-sha": "b".repeat(64),
      [invalidKey]: "NOT-A-SHA"
    };
    expect(() =>
      parseArgs([
        "execute-schedule",
        "--job",
        "job-1",
        "--confirm",
        "job-1",
        "--package-sha",
        values["package-sha"],
        "--audit-sha",
        values["audit-sha"]
      ])
    ).toThrow(`--${invalidKey} must be a lowercase SHA-256`);
  });
  it("rejects an unknown command", () => {
    expect(() => parseArgs(["dry-rnu"])).toThrow("Unknown command: dry-rnu");
  });

  it("rejects an unknown option", () => {
    expect(() => parseArgs(["dry-run", "--blgo", "blog.json"])).toThrow(
      "Unknown option --blgo for command dry-run"
    );
  });

  it("rejects a duplicate option", () => {
    expect(() => parseArgs(["check-schedule", "--job", "job-1", "--job", "job-2"])).toThrow(
      "Duplicate option --job"
    );
  });

  it("rejects an option without a value", () => {
    expect(() => parseArgs(["check-schedule", "--job"])).toThrow("Missing value for option --job");
  });

  it("rejects an option containing only whitespace", () => {
    expect(() => parseArgs(["check-schedule", "--job", "   "])).toThrow(
      "Missing value for option --job"
    );
  });

  it("rejects a command with a missing required option", () => {
    expect(() => parseArgs(["dry-run", "--blog", "blog.json"])).toThrow(
      "Missing required option --article"
    );
  });

  it("rejects a positional argument", () => {
    expect(() => parseArgs(["check-schedule", "job-1"])).toThrow(
      "Unexpected positional argument: job-1"
    );
  });
});
describe("commandRequiresDatabase", () => {
  it("keeps read-only entry commands independent from the database", () => {
    expect(commandRequiresDatabase("help")).toBe(false);
    expect(commandRequiresDatabase("open-login")).toBe(false);
    expect(commandRequiresDatabase("audit-drafts")).toBe(false);
    expect(commandRequiresDatabase("audit-published-post")).toBe(false);
    expect(commandRequiresDatabase("execute-schedule")).toBe(true);
    expect(commandRequiresDatabase("run-batch")).toBe(true);
    expect(commandRequiresDatabase("run-schedule-batch")).toBe(true);
    expect(commandRequiresDatabase("prepare-campaign")).toBe(true);
    expect(commandRequiresDatabase("inspect-campaign")).toBe(true);
    expect(commandRequiresDatabase("list-campaigns")).toBe(true);
  });

  it("requires the database for stateful commands", () => {
    expect(commandRequiresDatabase("init-db")).toBe(true);
    expect(commandRequiresDatabase("save-draft")).toBe(true);
    expect(commandRequiresDatabase("plan-schedule")).toBe(true);
    expect(commandRequiresDatabase("confirm-schedule-preview")).toBe(true);
    expect(commandRequiresDatabase("prepare-execution-package")).toBe(true);
    expect(commandRequiresDatabase("audit-execution-package")).toBe(true);
  });

  it("rejects a database policy lookup for an unknown command", () => {
    expect(() => commandRequiresDatabase("unknown")).toThrow("Unknown command: unknown");
  });
});
