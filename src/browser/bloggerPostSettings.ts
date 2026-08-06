import type { Locator, Page } from "@playwright/test";
import type { ArticleInput } from "../domain/article.js";
import type { BloggerSelectors } from "./bloggerSelectors.js";

export interface NormalizedPostSettings {
  labels: string[];
  searchDescription: string;
  slug: string;
}

export interface PostSettingsResult extends NormalizedPostSettings {
  applied: true;
}

export function validatePostSettingField(
  fieldName: string,
  actual: string,
  expected: string
): void {
  if (actual.trim() !== expected) {
    throw new Error(`Blogger ${fieldName} value mismatch`);
  }
}

export async function performPostSettingsMutationWithGuard<T>(
  assertCanMutate: (() => Promise<void>) | undefined,
  mutation: () => Promise<T>
): Promise<T> {
  await assertCanMutate?.();
  return mutation();
}

export function normalizePostSettings(article: ArticleInput): NormalizedPostSettings {
  const labels = [...new Set(article.labels.map((label) => label.trim()).filter(Boolean))];
  if (labels.some((label) => label.length > 200)) {
    throw new Error("Blogger labels must be 200 characters or fewer");
  }
  const searchDescription = article.searchDescription.trim();
  if (searchDescription.length > 150) {
    throw new Error("Blogger search description must be 150 characters or fewer");
  }
  const slug = article.slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Blogger slug must contain only lowercase ASCII letters, numbers, and hyphens");
  }
  return { labels, searchDescription, slug };
}

export class BloggerPostSettings {
  constructor(private readonly selectors: BloggerSelectors) {}

  async apply(
    page: Page,
    article: ArticleInput,
    assertCanMutate?: () => Promise<void>
  ): Promise<PostSettingsResult> {
    const settings = normalizePostSettings(article);
    if (settings.labels.length > 0) {
      await this.expandAndFill(
        page,
        this.selectors.labelsButton,
        this.selectors.labelsInput,
        settings.labels.join(", "),
        "labels",
        assertCanMutate
      );
    }
    await this.expandAndFill(
      page,
      this.selectors.searchDescriptionButton,
      this.selectors.searchDescriptionInput,
      settings.searchDescription,
      "search description",
      assertCanMutate
    );

    const permalinkButton = await this.firstVisible(page.locator(this.selectors.permalinkButton));
    if (!permalinkButton) throw new Error("Blogger permalink section was not detected");
    await performPostSettingsMutationWithGuard(assertCanMutate, () => permalinkButton.click());
    const customPermalink = await this.firstVisible(
      page.locator(this.selectors.customPermalinkOption)
    );
    if (!customPermalink) throw new Error("Blogger custom permalink option was not detected");
    if ((await customPermalink.getAttribute("aria-checked")) !== "true") {
      await performPostSettingsMutationWithGuard(assertCanMutate, () => customPermalink.click());
    }
    const permalinkInput = await this.firstEditable(page.locator(this.selectors.permalinkInput));
    if (!permalinkInput) throw new Error("Blogger custom permalink input was not detected");
    await performPostSettingsMutationWithGuard(assertCanMutate, () => permalinkInput.fill(settings.slug));
    validatePostSettingField("custom permalink", await permalinkInput.inputValue(), settings.slug);
    return { ...settings, applied: true };
  }

  private async expandAndFill(
    page: Page,
    buttonSelector: string,
    inputSelector: string,
    value: string,
    fieldName: string,
    assertCanMutate?: () => Promise<void>
  ): Promise<void> {
    const button = await this.firstVisible(page.locator(buttonSelector));
    if (!button) throw new Error(`Blogger ${fieldName} section was not detected`);
    const expanded = (await button.getAttribute("aria-expanded")) === "true";
    if (!expanded) await performPostSettingsMutationWithGuard(assertCanMutate, () => button.click());
    const input = await this.firstEditable(page.locator(inputSelector));
    if (!input) throw new Error(`Blogger ${fieldName} input was not detected`);
    await performPostSettingsMutationWithGuard(assertCanMutate, () => input.fill(value));
    validatePostSettingField(fieldName, await input.inputValue(), value);
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
      ) {
        return candidate;
      }
    }
    return null;
  }
}
