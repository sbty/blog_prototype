import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/env.js";
import {
  getChromeRecoveryProfilePath,
  launchChromePersistentContext
} from "../browser/chromeContext.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("Chrome persistent-context recovery", () => {
  it("uses a copied recovery profile without launching the configured profile", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "blogger-chrome-context-test-"));
    temporaryDirectories.push(root);
    const sourceProfile = path.join(root, "source-profile");
    await mkdir(path.join(sourceProfile, "Default"), { recursive: true });
    await writeFile(path.join(sourceProfile, "Default", "Preferences"), "original-profile", "utf8");
    const config = loadConfig({
      DATA_DIR: root,
      CHROME_PROFILE_PATH: sourceProfile,
      ENABLE_DRY_RUN: "false"
    });
    const context = { close: vi.fn().mockResolvedValue(undefined) };
    const launcher = {
      launchPersistentContext: vi.fn().mockResolvedValueOnce(context)
    };
    const recoveryPath = getChromeRecoveryProfilePath(config);
    await mkdir(path.join(recoveryPath, "Default"), { recursive: true });
    await writeFile(path.join(recoveryPath, "Default", "Preferences"), "stale-profile", "utf8");

    await expect(launchChromePersistentContext(config, launcher)).resolves.toBe(context);

    const [sessionPath] = launcher.launchPersistentContext.mock.calls.map(([profile]) => profile);
    expect(sessionPath).toMatch(
      new RegExp(`${root.replaceAll("\\", "\\\\")}.*chrome-profile-playwright-session-`)
    );
    await expect(
      readFile(path.join(sourceProfile, "Default", "Preferences"), "utf8")
    ).resolves.toBe("original-profile");
    await expect(readFile(path.join(recoveryPath, "Default", "Preferences"), "utf8")).resolves.toBe(
      "original-profile"
    );
    await context.close();
    await expect(readdir(root)).resolves.not.toContain(path.basename(sessionPath));
  });

  it("keeps the configured profile unchanged when the recovery launch fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "blogger-chrome-context-test-"));
    temporaryDirectories.push(root);
    const sourceProfile = path.join(root, "source-profile");
    await mkdir(path.join(sourceProfile, "Default"), { recursive: true });
    await writeFile(path.join(sourceProfile, "Default", "Preferences"), "original-profile", "utf8");
    const config = loadConfig({
      DATA_DIR: root,
      CHROME_PROFILE_PATH: sourceProfile,
      ENABLE_DRY_RUN: "false"
    });
    const launcher = {
      launchPersistentContext: vi.fn().mockRejectedValue(new Error("Executable missing"))
    };

    await expect(launchChromePersistentContext(config, launcher)).rejects.toThrow(
      "Executable missing"
    );
    expect(launcher.launchPersistentContext).toHaveBeenCalledTimes(1);
    await expect(
      readFile(path.join(sourceProfile, "Default", "Preferences"), "utf8")
    ).resolves.toBe("original-profile");
    expect(
      (await readdir(root)).filter((entry) =>
        entry.startsWith("chrome-profile-playwright-session-")
      )
    ).toEqual([]);
  });

  it("removes a stale copied lock before launching an isolated session", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "blogger-chrome-context-test-"));
    temporaryDirectories.push(root);
    const sourceProfile = path.join(root, "source-profile");
    await mkdir(path.join(sourceProfile, "Default"), { recursive: true });
    await writeFile(path.join(sourceProfile, "Default", "LOCK"), "stale", "utf8");
    const config = loadConfig({
      DATA_DIR: root,
      CHROME_PROFILE_PATH: sourceProfile,
      ENABLE_DRY_RUN: "false"
    });
    const context = { close: vi.fn().mockResolvedValue(undefined) };
    const launcher = { launchPersistentContext: vi.fn().mockResolvedValue(context) };

    await launchChromePersistentContext(config, launcher);

    const [sessionPath] = launcher.launchPersistentContext.mock.calls[0];
    await expect(
      readFile(path.join(getChromeRecoveryProfilePath(config), "Default", "LOCK"), "utf8")
    ).resolves.toBe("stale");
    await expect(readFile(path.join(sessionPath, "Default", "LOCK"), "utf8")).rejects.toThrow();
    await context.close();
  });

  it("serializes concurrent recovery refreshes while creating isolated sessions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "blogger-chrome-context-test-"));
    temporaryDirectories.push(root);
    const sourceProfile = path.join(root, "source-profile");
    await mkdir(path.join(sourceProfile, "Default"), { recursive: true });
    await writeFile(path.join(sourceProfile, "Default", "Preferences"), "shared-profile", "utf8");
    const config = loadConfig({
      DATA_DIR: root,
      CHROME_PROFILE_PATH: sourceProfile,
      ENABLE_DRY_RUN: "false"
    });
    const contexts = Array.from({ length: 4 }, () => ({
      close: vi.fn().mockResolvedValue(undefined)
    }));
    let launchIndex = 0;
    const launcher = {
      launchPersistentContext: vi.fn().mockImplementation(async (sessionPath: string) => {
        const context = contexts[launchIndex++];
        await expect(
          readFile(path.join(sessionPath, "Default", "Preferences"), "utf8")
        ).resolves.toBe("shared-profile");
        return context;
      })
    };

    const launched = await Promise.all(
      contexts.map(() => launchChromePersistentContext(config, launcher))
    );

    expect(new Set(launcher.launchPersistentContext.mock.calls.map(([profile]) => profile)).size).toBe(
      contexts.length
    );
    await Promise.all(launched.map((context) => context.close()));
  });
});
