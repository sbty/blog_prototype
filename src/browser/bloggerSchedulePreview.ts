import type { Locator, Page } from "@playwright/test";
import type { BloggerSelectors } from "./bloggerSelectors.js";

export interface SchedulePreviewValue {
  scheduledAt: string;
  date: string;
  time: string;
  timezone: string;
}

export function validateSchedulePreviewFields(
  actualDate: string,
  actualTime: string,
  expected: SchedulePreviewValue
): void {
  const trimmedDate = actualDate.trim();
  const japaneseDate = trimmedDate.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  const normalizedDate = japaneseDate
    ? `${japaneseDate[1]}/${japaneseDate[2].padStart(2, "0")}/${japaneseDate[3].padStart(2, "0")}`
    : trimmedDate.replaceAll("-", "/");
  const normalizedTime = actualTime.trim().slice(0, 5);
  if (normalizedDate !== expected.date || normalizedTime !== expected.time) {
    throw new Error(
      `Blogger schedule preview mismatch: expected ${expected.date} ${expected.time}, actual ${actualDate.trim()} ${actualTime.trim()}`
    );
  }
}

export async function performSchedulePreviewMutationWithGuard<T>(
  assertCanMutate: (() => Promise<void>) | undefined,
  mutation: () => Promise<T>
): Promise<T> {
  await assertCanMutate?.();
  return mutation();
}

export function prepareSchedulePreview(
  scheduledAt: string,
  timezone: string,
  now = new Date()
): SchedulePreviewValue {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(scheduledAt)) {
    throw new Error("Scheduled time must include a UTC offset");
  }
  const target = new Date(scheduledAt);
  if (Number.isNaN(target.getTime())) throw new Error("Scheduled time is invalid");
  if (target.getTime() <= now.getTime() + 10 * 60 * 1000) {
    throw new Error("Scheduled time must be at least 10 minutes in the future");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(target);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    scheduledAt: target.toISOString(),
    date: `${value("year")}/${value("month")}/${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
    timezone
  };
}

export class BloggerSchedulePreview {
  constructor(
    private readonly selectors: BloggerSelectors,
    private readonly timezone: string
  ) {}

  async apply(
    page: Page,
    scheduledAt: string,
    assertCanMutate?: () => Promise<void>
  ): Promise<SchedulePreviewValue> {
    const preview = prepareSchedulePreview(scheduledAt, this.timezone);
    const section = await this.firstVisible(page.locator(this.selectors.scheduleButton));
    if (!section) throw new Error("Blogger publish date section was not detected");
    if ((await section.getAttribute("aria-expanded")) !== "true")
      await performSchedulePreviewMutationWithGuard(assertCanMutate, () => section.click());

    const setDateTime = await this.firstVisible(page.locator(this.selectors.scheduleSetDateTime));
    if (!setDateTime) throw new Error("Blogger set date and time option was not detected");
    if ((await setDateTime.getAttribute("aria-checked")) !== "true")
      await performSchedulePreviewMutationWithGuard(assertCanMutate, () => setDateTime.click());

    const dateInput = await this.firstEditable(page.locator(this.selectors.scheduleDateInput));
    const timeInput = await this.firstEditable(page.locator(this.selectors.scheduleTimeInput));
    if (!dateInput || !timeInput)
      throw new Error("Blogger schedule date or time input was not detected");
    await performSchedulePreviewMutationWithGuard(assertCanMutate, () =>
      dateInput.fill(preview.date)
    );
    await performSchedulePreviewMutationWithGuard(assertCanMutate, () =>
      timeInput.fill(preview.time)
    );
    validateSchedulePreviewFields(
      await dateInput.inputValue(),
      await timeInput.inputValue(),
      preview
    );
    return preview;
  }

  private async firstVisible(locator: Locator, timeout = 5000): Promise<Locator | null> {
    await locator
      .first()
      .waitFor({ state: "attached", timeout })
      .catch(() => undefined);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
    return null;
  }

  private async firstEditable(locator: Locator, timeout = 5000): Promise<Locator | null> {
    await locator
      .first()
      .waitFor({ state: "attached", timeout })
      .catch(() => undefined);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (
        (await candidate.isVisible().catch(() => false)) &&
        (await candidate.isEditable().catch(() => false))
      )
        return candidate;
    }
    return null;
  }
}
