import { describe, expect, it, vi } from "vitest";
import {
  fetchAndValidateBloggerTimezone,
  timezoneOffsetMinutes,
  validateBloggerFeedTimezone
} from "../services/bloggerTimezoneValidation.js";

function feed(publishedAt: string): unknown {
  return { feed: { entry: [{ published: { $t: publishedAt } }] } };
}

describe("Blogger timezone validation", () => {
  it("accepts a feed offset matching Asia/Tokyo", () => {
    const result = validateBloggerFeedTimezone({
      feed: feed("2026-08-05T22:00:00.000+09:00"),
      publicUrl: "https://example.blogspot.com/",
      expectedTimezone: "Asia/Tokyo",
      checkedAt: new Date("2026-08-05T12:00:00.000Z")
    });
    expect(result.expectedOffsetMinutes).toBe(540);
    expect(result.observedOffsetMinutes).toBe(540);
    expect(result.observedTimestampSource).toBe("entry.published");
  });

  it("accepts feed.updated for a blog with no published entries", () => {
    const result = validateBloggerFeedTimezone({
      feed: { feed: { updated: { $t: "2026-08-10T02:20:00.000+09:00" } } },
      publicUrl: "https://empty-example.blogspot.com/",
      expectedTimezone: "Asia/Tokyo"
    });
    expect(result.observedOffsetMinutes).toBe(540);
    expect(result.observedTimestampSource).toBe("feed.updated");
  });

  it("rejects the observed Blogger Pacific offset", () => {
    expect(() =>
      validateBloggerFeedTimezone({
        feed: feed("2026-08-05T06:00:00.000-07:00"),
        publicUrl: "https://example.blogspot.com/",
        expectedTimezone: "Asia/Tokyo"
      })
    ).toThrow("timezone offset mismatch");
  });

  it("rejects missing or offset-free timestamps", () => {
    expect(() =>
      validateBloggerFeedTimezone({
        feed: {},
        publicUrl: "https://example.blogspot.com/",
        expectedTimezone: "Asia/Tokyo"
      })
    ).toThrow("valid published timestamp");
    expect(() =>
      validateBloggerFeedTimezone({
        feed: feed("2026-08-05T22:00:00.000"),
        publicUrl: "https://example.blogspot.com/",
        expectedTimezone: "Asia/Tokyo"
      })
    ).toThrow("no UTC offset");
  });

  it("fails closed on HTTP and JSON errors", async () => {
    const httpFetch = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(
      fetchAndValidateBloggerTimezone({
        publicUrl: "https://example.blogspot.com/",
        expectedTimezone: "Asia/Tokyo",
        fetchImpl: httpFetch
      })
    ).rejects.toThrow("HTTP 503");
    const jsonFetch = vi.fn(async () => new Response("not-json", { status: 200 }));
    await expect(
      fetchAndValidateBloggerTimezone({
        publicUrl: "https://example.blogspot.com/",
        expectedTimezone: "Asia/Tokyo",
        fetchImpl: jsonFetch
      })
    ).rejects.toThrow("not valid JSON");
  });

  it("computes timezone offsets for the supplied instant", () => {
    expect(timezoneOffsetMinutes("Asia/Tokyo", new Date("2026-08-05T00:00:00Z"))).toBe(540);
  });
});
