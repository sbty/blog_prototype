import { describe, expect, it, vi } from "vitest";
import {
  performSchedulePreviewMutationWithGuard,
  prepareSchedulePreview,
  validateSchedulePreviewFields
} from "../browser/bloggerSchedulePreview.js";

describe("prepareSchedulePreview", () => {
  it("formats an offset timestamp in the application timezone", () => {
    expect(
      prepareSchedulePreview("2026-08-01T00:00:00Z", "Asia/Tokyo", new Date("2026-07-30T00:00:00Z"))
    ).toEqual({
      scheduledAt: "2026-08-01T00:00:00.000Z",
      date: "2026/08/01",
      time: "09:00",
      timezone: "Asia/Tokyo"
    });
  });

  it("rejects missing offsets and times that are too close", () => {
    const now = new Date("2026-07-30T00:00:00Z");
    expect(() => prepareSchedulePreview("2026-08-01T09:00:00", "Asia/Tokyo", now)).toThrow(
      "UTC offset"
    );
    expect(() => prepareSchedulePreview("2026-07-30T00:05:00Z", "Asia/Tokyo", now)).toThrow(
      "at least 10 minutes"
    );
  });
});
describe("performSchedulePreviewMutationWithGuard", () => {
  it("does not mutate schedule fields after STOP", async () => {
    const mutation = vi.fn(async () => undefined);
    await expect(
      performSchedulePreviewMutationWithGuard(async () => {
        throw new Error("STOP requested");
      }, mutation)
    ).rejects.toThrow("STOP requested");
    expect(mutation).not.toHaveBeenCalled();
  });
});
describe("validateSchedulePreviewFields", () => {
  const expected = {
    scheduledAt: "2026-08-01T00:00:00.000Z",
    date: "2026/08/01",
    time: "09:00",
    timezone: "Asia/Tokyo"
  };

  it("accepts matching values read back from the UI", () => {
    expect(() => validateSchedulePreviewFields("2026/08/01", "09:00", expected)).not.toThrow();
  });

  it("accepts normalized HTML date and time input values", () => {
    expect(() => validateSchedulePreviewFields("2026-08-01", "09:00:00", expected)).not.toThrow();
  });
  it("accepts Blogger's Japanese localized date readback", () => {
    expect(() => validateSchedulePreviewFields("2026年8月1日", "09:00", expected)).not.toThrow();
  });
  it("rejects values that the UI did not retain", () => {
    expect(() => validateSchedulePreviewFields("2026/08/01", "10:00", expected)).toThrow(
      "schedule preview mismatch"
    );
  });
});
