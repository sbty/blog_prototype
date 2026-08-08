import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/env.js";
import type {
  CampaignItemAction,
  ScheduleCampaignInspectionResult
} from "./scheduleCampaignInspectionService.js";

const maxCampaigns = 1000;

interface CampaignInspector {
  execute(input: { campaignId: string }): Promise<ScheduleCampaignInspectionResult>;
}

export type CampaignListState =
  "READY_TO_EXECUTE" | "RETRY_AVAILABLE" | "COMPLETED" | "ATTENTION" | "EMPTY" | "INVALID";

export interface CampaignListItem {
  campaignId: string;
  state: CampaignListState;
  completedAt?: string;
  counts?: Record<CampaignItemAction, number>;
  executionManifestValid?: boolean;
  retryManifestValid?: boolean;
  error?: string;
}

export interface ScheduleCampaignListResult {
  generatedAt: string;
  total: number;
  campaigns: CampaignListItem[];
}

export class ScheduleCampaignListService {
  constructor(
    private readonly config: AppConfig,
    private readonly inspector: CampaignInspector
  ) {}

  async execute(): Promise<ScheduleCampaignListResult> {
    const campaignIds = await this.findCampaignIds();
    const campaigns: CampaignListItem[] = [];
    for (const campaignId of campaignIds) {
      try {
        const inspection = await this.inspector.execute({ campaignId });
        campaigns.push({
          campaignId,
          state: this.classify(inspection),
          completedAt: inspection.completedAt,
          counts: inspection.counts,
          executionManifestValid: inspection.executionManifest.valid,
          retryManifestValid: inspection.retryManifest.valid
        });
      } catch (error) {
        campaigns.push({
          campaignId,
          state: "INVALID",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    campaigns.sort((left, right) => {
      if (left.completedAt && right.completedAt) {
        return right.completedAt.localeCompare(left.completedAt);
      }
      if (left.completedAt) return -1;
      if (right.completedAt) return 1;
      return right.campaignId.localeCompare(left.campaignId);
    });
    return { generatedAt: new Date().toISOString(), total: campaigns.length, campaigns };
  }

  private classify(inspection: ScheduleCampaignInspectionResult): CampaignListState {
    const attention =
      inspection.counts.EVIDENCE_INVALID +
      inspection.counts.JOB_MISSING +
      inspection.counts.JOB_STATE_INVALID +
      inspection.counts.NEEDS_ATTENTION;
    if (attention > 0 || !inspection.executionManifest.valid || !inspection.retryManifest.valid) {
      return "ATTENTION";
    }
    if (inspection.counts.RETRY_AVAILABLE > 0) return "RETRY_AVAILABLE";
    if (inspection.counts.READY_TO_EXECUTE > 0) return "READY_TO_EXECUTE";
    if (inspection.counts.EXECUTED > 0) return "COMPLETED";
    return "EMPTY";
  }

  private async findCampaignIds(): Promise<string[]> {
    let dataRoot: string;
    let jobsRoot: string;
    try {
      dataRoot = await realpath(this.config.DATA_DIR);
      jobsRoot = await realpath(path.join(dataRoot, "jobs"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const relative = path.relative(dataRoot, jobsRoot);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("DATA_DIR/jobs must resolve inside DATA_DIR");
    }
    const entries = await readdir(jobsRoot, { withFileTypes: true });
    const campaignIds = entries
      .filter(
        (entry) =>
          entry.isDirectory() && /^schedule-campaign-[A-Za-z0-9._-]{1,182}$/.test(entry.name)
      )
      .map((entry) => entry.name);
    if (campaignIds.length > maxCampaigns) {
      throw new Error(`Too many campaign directories to inspect: ${campaignIds.length}`);
    }
    return campaignIds;
  }
}
