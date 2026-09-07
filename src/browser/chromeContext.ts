import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext } from "@playwright/test";
import type { AppConfig } from "../config/env.js";
import { getChromeProfilePath } from "./chromeProfile.js";

type PersistentContextLauncher = Pick<typeof chromium, "launchPersistentContext">;

export function getChromeRecoveryProfilePath(config: Pick<AppConfig, "DATA_DIR">): string {
  return path.resolve(config.DATA_DIR, "chrome-profile-playwright-recovery");
}

function launchOptions(config: AppConfig) {
  return {
    headless: config.HEADLESS,
    executablePath: config.CHROME_EXECUTABLE_PATH || undefined,
    channel: config.CHROME_EXECUTABLE_PATH ? undefined : config.CHROME_CHANNEL || "chrome",
    locale: "ja-JP",
    timezoneId: config.APP_TIMEZONE,
    viewport: { width: 1920, height: 1080 }
  };
}

async function ensureRecoveryProfile(sourcePath: string, recoveryPath: string): Promise<void> {
  if (existsSync(recoveryPath)) return;
  await mkdir(path.dirname(recoveryPath), { recursive: true });
  await cp(sourcePath, recoveryPath, { recursive: true, force: false, errorOnExist: true });
}

async function removeSessionLocks(sessionPath: string): Promise<void> {
  await Promise.all(
    ["SingletonLock", "SingletonCookie", "SingletonSocket", path.join("Default", "LOCK")].map(
      (entry) => rm(path.join(sessionPath, entry), { force: true, recursive: true })
    )
  );
}

export async function launchChromePersistentContext(
  config: AppConfig,
  launcher: PersistentContextLauncher = chromium
): Promise<BrowserContext> {
  const profilePath = getChromeProfilePath(config);
  await mkdir(profilePath, { recursive: true });
  const recoveryPath = getChromeRecoveryProfilePath(config);
  await ensureRecoveryProfile(profilePath, recoveryPath);
  const sessionPath = await mkdtemp(
    path.join(config.DATA_DIR, "chrome-profile-playwright-session-")
  );
  try {
    await cp(recoveryPath, sessionPath, { recursive: true, force: false, errorOnExist: true });
    await removeSessionLocks(sessionPath);
    const context = await launcher.launchPersistentContext(sessionPath, launchOptions(config));
    const close = context.close.bind(context);
    context.close = async (...args) => {
      try {
        return await close(...args);
      } finally {
        await rm(sessionPath, { recursive: true, force: true });
      }
    };
    return context;
  } catch (error) {
    await rm(sessionPath, { recursive: true, force: true });
    throw error;
  }
}
