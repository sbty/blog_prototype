import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/env.js";

describe("loadConfig", () => {
  it("loads PRD defaults", () => {
    const config = loadConfig({});
    expect(config.APP_TIMEZONE).toBe("Asia/Tokyo");
    expect(config.ENABLE_DRY_RUN).toBe(true);
    expect(config.ENABLE_DRAFT_SAVE).toBe(false);
    expect(config.MIN_CONFIDENCE).toBe(0.65);
  });

  it.each(["0", "-1", "abc", "3items"])("rejects an unsafe daily limit: %s", (value) => {
    expect(() => loadConfig({ SYSTEM_DAILY_POST_LIMIT: value })).toThrow(
      "Expected a positive integer"
    );
  });

  it.each(["-1", "101", "Infinity", "not-a-number"])(
    "rejects an invalid quality score: %s",
    (value) => {
      expect(() => loadConfig({ MIN_OPPORTUNITY_SCORE: value })).toThrow();
    }
  );

  it.each(["-0.1", "1.1", "Infinity", "not-a-number"])(
    "rejects an invalid confidence threshold: %s",
    (value) => {
      expect(() => loadConfig({ MIN_CONFIDENCE: value })).toThrow();
    }
  );

  it("accepts score and confidence boundary values", () => {
    const config = loadConfig({ MIN_OPPORTUNITY_SCORE: "100", MIN_CONFIDENCE: "0" });
    expect(config.MIN_OPPORTUNITY_SCORE).toBe(100);
    expect(config.MIN_CONFIDENCE).toBe(0);
  });
  it("defaults the authorized test blog ID to disabled", () => {
    expect(loadConfig({}).AUTHORIZED_TEST_BLOG_ID).toBe("");
  });
  it("accepts a numeric authorized test blog ID", () => {
    expect(
      loadConfig({ AUTHORIZED_TEST_BLOG_ID: "1234567890123456789" }).AUTHORIZED_TEST_BLOG_ID
    ).toBe("1234567890123456789");
  });
  it.each(["abc", "123", "1234-not-numeric"])(
    "rejects an invalid authorized test blog ID: %s",
    (value) => {
      expect(() => loadConfig({ AUTHORIZED_TEST_BLOG_ID: value })).toThrow(
        "Expected an empty value or a numeric Blogger blog ID"
      );
    }
  );
  it("rejects an invalid application timezone", () => {
    expect(() => loadConfig({ APP_TIMEZONE: "Mars/Olympus" })).toThrow(
      "Expected a valid IANA timezone"
    );
  });
  it.each(["DATABASE_PATH", "DATA_DIR"] as const)("rejects an empty local path for %s", (key) => {
    expect(() => loadConfig({ [key]: "   " })).toThrow("Expected a non-empty path");
  });
  it.each(["DATABASE_PATH", "DATA_DIR"] as const)("rejects a NUL character in %s", (key) => {
    expect(() => loadConfig({ [key]: `safe\0unsafe` })).toThrow(
      "Path must not contain a NUL character"
    );
  });
  it("rejects an invalid boolean flag instead of silently disabling it", () => {
    expect(() => loadConfig({ ENABLE_SCHEDULED_POST: "treu" })).toThrow("Expected a boolean value");
  });

  it("parses supported boolean aliases case-insensitively", () => {
    const config = loadConfig({ ENABLE_DRAFT_SAVE: " YES ", ENABLE_DRY_RUN: "OFF" });
    expect(config.ENABLE_DRAFT_SAVE).toBe(true);
    expect(config.ENABLE_DRY_RUN).toBe(false);
  });
  it("parses boolean flags", () => {
    const config = loadConfig({ HEADLESS: "true", ENABLE_DRY_RUN: "0" });
    expect(config.HEADLESS).toBe(true);
    expect(config.ENABLE_DRY_RUN).toBe(false);
  });

  it("rejects an unsupported log level during config loading", () => {
    expect(() => loadConfig({ LOG_LEVEL: "verbose" })).toThrow();
  });

  it.each(["fatal", "error", "warn", "info", "debug", "trace", "silent"])(
    "accepts the supported log level: %s",
    (level) => {
      expect(loadConfig({ LOG_LEVEL: level }).LOG_LEVEL).toBe(level);
    }
  );
});
