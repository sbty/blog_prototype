export interface BloggerTimezoneEvidence {
  publicUrl: string;
  expectedTimezone: string;
  expectedOffsetMinutes: number;
  observedOffsetMinutes: number;
  observedPublishedAt: string;
  checkedAt: string;
}

function parseOffsetMinutes(value: string): number {
  const match = value.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Blogger feed timestamp has no UTC offset");
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

export function timezoneOffsetMinutes(timezone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset"
  }).formatToParts(instant);
  const name = parts.find((part) => part.type === "timeZoneName")?.value;
  if (!name) throw new Error("Application timezone offset could not be determined");
  if (name === "GMT") return 0;
  return parseOffsetMinutes(name.replace("GMT", ""));
}

export function validateBloggerFeedTimezone(input: {
  feed: unknown;
  publicUrl: string;
  expectedTimezone: string;
  checkedAt?: Date;
}): BloggerTimezoneEvidence {
  const checkedAt = input.checkedAt ?? new Date();
  const entry = (input.feed as { feed?: { entry?: Array<{ published?: { $t?: unknown } }> } })?.feed
    ?.entry?.[0];
  const publishedAt = entry?.published?.$t;
  if (typeof publishedAt !== "string" || !Number.isFinite(Date.parse(publishedAt))) {
    throw new Error("Blogger feed does not contain a valid published timestamp");
  }
  const observedOffsetMinutes = parseOffsetMinutes(publishedAt);
  const expectedOffsetMinutes = timezoneOffsetMinutes(
    input.expectedTimezone,
    new Date(publishedAt)
  );
  if (observedOffsetMinutes !== expectedOffsetMinutes) {
    throw new Error(
      `Blogger timezone offset mismatch: observed ${observedOffsetMinutes}, expected ${expectedOffsetMinutes} minutes for ${input.expectedTimezone}`
    );
  }
  return {
    publicUrl: input.publicUrl,
    expectedTimezone: input.expectedTimezone,
    expectedOffsetMinutes,
    observedOffsetMinutes,
    observedPublishedAt: publishedAt,
    checkedAt: checkedAt.toISOString()
  };
}

export async function fetchAndValidateBloggerTimezone(input: {
  publicUrl: string;
  expectedTimezone: string;
  fetchImpl?: typeof fetch;
}): Promise<BloggerTimezoneEvidence> {
  const url = new URL("feeds/posts/default?alt=json&max-results=1", input.publicUrl);
  if (url.protocol !== "https:") throw new Error("Blogger public URL must use HTTPS");
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "GET",
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok)
    throw new Error(`Blogger timezone feed request failed: HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 1_000_000)
    throw new Error("Blogger timezone feed is too large");
  let feed: unknown;
  try {
    feed = JSON.parse(text);
  } catch {
    throw new Error("Blogger timezone feed is not valid JSON");
  }
  return validateBloggerFeedTimezone({
    feed,
    publicUrl: input.publicUrl,
    expectedTimezone: input.expectedTimezone
  });
}
