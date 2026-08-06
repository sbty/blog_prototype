import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/env.js";

export function getChromeProfilePath(config: Pick<AppConfig, "CHROME_PROFILE_PATH" | "DATA_DIR">): string {
  return path.resolve(config.CHROME_PROFILE_PATH || path.join(config.DATA_DIR, "chrome-profile"));
}

export function getChromeExecutable(config: Pick<AppConfig, "CHROME_EXECUTABLE_PATH">): string {
  if (config.CHROME_EXECUTABLE_PATH) {
    return config.CHROME_EXECUTABLE_PATH;
  }

  if (process.platform === "win32") {
    const candidates = [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "",
      process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : "",
      process.env["PROGRAMFILES(X86)"]
        ? path.join(process.env["PROGRAMFILES(X86)"]!, "Google", "Chrome", "Application", "chrome.exe")
        : ""
    ].filter(Boolean);

    const found = candidates.find((candidate) => existsSync(candidate));
    if (found) {
      return found;
    }
  }

  return process.platform === "darwin" ? "Google Chrome" : "google-chrome";
}

export async function openChromeForManualLogin(input: { config: AppConfig; url: string }): Promise<{ profilePath: string }> {
  const profilePath = getChromeProfilePath(input.config);
  await mkdir(profilePath, { recursive: true });

  const child = spawn(
    getChromeExecutable(input.config),
    [
      `--user-data-dir=${profilePath}`,
      "--profile-directory=Default",
      "--no-first-run",
      "--new-window",
      input.url
    ],
    {
      detached: true,
      stdio: "ignore"
    }
  );
  child.unref();

  return { profilePath };
}
