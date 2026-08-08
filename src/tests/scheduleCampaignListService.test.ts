import { mkdtempSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/env.js";
import {
  ScheduleCampaignListService,
  type CampaignListState
} from "../services/scheduleCampaignListService.js";
import type {
  CampaignItemAction,
  ScheduleCampaignInspectionResult
} from "../services/scheduleCampaignInspectionService.js";

const actions: CampaignItemAction[] = [
  "READY_TO_EXECUTE",
  "RETRY_AVAILABLE",
  "EXECUTED",
  "EVIDENCE_INVALID",
  "JOB_MISSING",
  "JOB_STATE_INVALID",
  "NEEDS_ATTENTION"
];

function inspection(
  campaignId: string,
  completedAt: string,
  action?: CampaignItemAction,
  manifestsValid = true
): ScheduleCampaignInspectionResult {
  const counts = Object.fromEntries(
    actions.map((value) => [value, value === action ? 1 : 0])
  ) as Record<CampaignItemAction, number>;
  return {
    campaignId,
    inspectedAt: "2026-08-09T00:00:00.000Z",
    completedAt,
    reportValid: true,
    executionManifest: { present: Boolean(action), valid: manifestsValid },
    retryManifest: { present: action === "RETRY_AVAILABLE", valid: manifestsValid },
    counts,
    items: []
  };
}

function fixture() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "blogger-campaign-list-"));
  const jobsDir = path.join(dataDir, "jobs");
  mkdirSync(jobsDir);
  for (const name of [
    "schedule-campaign-old",
    "schedule-campaign-new",
    "schedule-campaign-bad",
    "job-1"
  ]) {
    mkdirSync(path.join(jobsDir, name));
  }
  const results = new Map<string, ScheduleCampaignInspectionResult>([
    [
      "schedule-campaign-old",
      inspection("schedule-campaign-old", "2026-08-01T00:00:00.000Z", "EXECUTED")
    ],
    [
      "schedule-campaign-new",
      inspection("schedule-campaign-new", "2026-08-02T00:00:00.000Z", "READY_TO_EXECUTE")
    ]
  ]);
  const inspector = {
    execute: vi.fn(async ({ campaignId }: { campaignId: string }) => {
      const result = results.get(campaignId);
      if (!result) throw new Error("invalid campaign report");
      return result;
    })
  };
  const config = loadConfig({ DATA_DIR: dataDir, DATABASE_PATH: path.join(dataDir, "app.sqlite") });
  return { dataDir, inspector, service: new ScheduleCampaignListService(config, inspector) };
}

describe("ScheduleCampaignListService", () => {
  it("lists campaign directories newest first and classifies their next action", async () => {
    const { service, inspector } = fixture();
    const result = await service.execute();

    expect(result.total).toBe(3);
    expect(result.campaigns.map((campaign) => [campaign.campaignId, campaign.state])).toEqual([
      ["schedule-campaign-new", "READY_TO_EXECUTE"],
      ["schedule-campaign-old", "COMPLETED"],
      ["schedule-campaign-bad", "INVALID"]
    ] satisfies Array<[string, CampaignListState]>);
    expect(inspector.execute).toHaveBeenCalledTimes(3);
    expect(inspector.execute).not.toHaveBeenCalledWith({ campaignId: "job-1" });
  });

  it("prioritizes attention and retry states", async () => {
    const { dataDir } = fixture();
    const inspector = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(
          inspection("schedule-campaign-old", "2026-08-01T00:00:00.000Z", "RETRY_AVAILABLE")
        )
        .mockResolvedValueOnce(
          inspection("schedule-campaign-new", "2026-08-02T00:00:00.000Z", "EXECUTED", false)
        )
        .mockRejectedValueOnce(new Error("invalid"))
    };
    const config = loadConfig({
      DATA_DIR: dataDir,
      DATABASE_PATH: path.join(dataDir, "app.sqlite")
    });
    const result = await new ScheduleCampaignListService(config, inspector).execute();
    expect(result.campaigns.map((campaign) => campaign.state).sort()).toEqual([
      "ATTENTION",
      "INVALID",
      "RETRY_AVAILABLE"
    ]);
  });

  it("returns an empty list before the jobs directory exists", async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "blogger-empty-campaign-list-"));
    const config = loadConfig({
      DATA_DIR: dataDir,
      DATABASE_PATH: path.join(dataDir, "app.sqlite")
    });
    const inspector = { execute: vi.fn() };
    const result = await new ScheduleCampaignListService(config, inspector).execute();
    expect(result).toMatchObject({ total: 0, campaigns: [] });
    expect(inspector.execute).not.toHaveBeenCalled();
  });
});
