import { cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext } from "@playwright/test";
import type { AppConfig } from "../config/env.js";
import { getChromeProfilePath } from "./chromeProfile.js";

type PersistentContextLauncher = Pick<typeof chromium, "launchPersistentContext">;

const profilePreparationTails = new Map<string, Promise<void>>();

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

async function refreshRecoveryProfile(sourcePath: string, recoveryPath: string): Promise<void> {
  const parentPath = path.dirname(recoveryPath);
  await mkdir(parentPath, { recursive: true });
  const stagingPath = await mkdtemp(
    path.join(parentPath, `${path.basename(recoveryPath)}-refresh-`)
  );
  await rm(stagingPath, { recursive: true });
  try {
    await cp(sourcePath, stagingPath, { recursive: true, force: false, errorOnExist: true });
    await rm(recoveryPath, { recursive: true, force: true });
    await rename(stagingPath, recoveryPath);
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

async function removeSessionLocks(sessionPath: string): Promise<void> {
  await Promise.all(
    ["SingletonLock", "SingletonCookie", "SingletonSocket", path.join("Default", "LOCK")].map(
      (entry) => rm(path.join(sessionPath, entry), { force: true, recursive: true })
    )
  );
}

async function prepareSessionProfile(
  sourcePath: string,
  recoveryPath: string,
  dataDir: string
): Promise<string> {
  const previous = profilePreparationTails.get(recoveryPath) ?? Promise.resolve();
  const preparation = previous.catch(() => undefined).then(async () => {
    await refreshRecoveryProfile(sourcePath, recoveryPath);
    const sessionPath = await mkdtemp(path.join(dataDir, "chrome-profile-playwright-session-"));
    try {
      // fs.cp requires a non-existent destination when errorOnExist is enabled.
      // mkdtemp gives us an exclusive path, so remove that empty placeholder first.
      await rm(sessionPath, { recursive: true });
      await cp(recoveryPath, sessionPath, { recursive: true, force: false, errorOnExist: true });
      await removeSessionLocks(sessionPath);
      return sessionPath;
    } catch (error) {
      await rm(sessionPath, { recursive: true, force: true });
      throw error;
    }
  });
  const tail = preparation.then(
    () => undefined,
    () => undefined
  );
  profilePreparationTails.set(recoveryPath, tail);
  try {
    return await preparation;
  } finally {
    if (profilePreparationTails.get(recoveryPath) === tail) {
      profilePreparationTails.delete(recoveryPath);
    }
  }
}

export async function launchChromePersistentContext(
  config: AppConfig,
  launcher: PersistentContextLauncher = chromium
): Promise<BrowserContext> {
  const profilePath = getChromeProfilePath(config);
  await mkdir(profilePath, { recursive: true });
  const recoveryPath = getChromeRecoveryProfilePath(config);
  const sessionPath = await prepareSessionProfile(profilePath, recoveryPath, config.DATA_DIR);
  try {
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
