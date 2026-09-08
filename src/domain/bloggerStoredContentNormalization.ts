const leadingBloggerImageWrapper =
  /^\s*(<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bseparator\b[^"']*["'])[^>]*>\s*<a\b(?=[^>]*\bhref\s*=\s*["']https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com\/[^"']+["'])[^>]*>\s*<img\b(?=[^>]*\bsrc\s*=\s*["']https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com\/[^"']+["'])(?=[^>]*\bdata-original-height\s*=\s*["']\d+["'])(?=[^>]*\bdata-original-width\s*=\s*["']\d+["'])[^>]*>\s*<\/a>\s*<\/div>)([\s\S]+)$/i;

function trimHtml(value: string): string {
  return value.trim().replaceAll("\r\n", "\n");
}

function leadingWrapper(html: string): { wrapper: string; remainder: string } | undefined {
  const match = html.match(leadingBloggerImageWrapper);
  if (!match || !match[2].trim()) return undefined;
  return { wrapper: match[1], remainder: match[2] };
}

/**
 * Blogger prepends this wrapper when a locally uploaded image is persisted.  It is
 * deliberately recognized only in its generated shape, and only for an article
 * which is expected to have exactly one image.
 */
export function normalizeBloggerStoredHtml(input: {
  expectedHtml: string;
  actualHtml: string;
  expectedImageCount: number;
}): { expected: string; actual: string; strippedImageWrapper: boolean } {
  const expected = trimHtml(input.expectedHtml);
  const actual = trimHtml(input.actualHtml);
  if (input.expectedImageCount !== 1) {
    return { expected, actual, strippedImageWrapper: false };
  }
  const wrapper = leadingWrapper(actual);
  if (!wrapper) return { expected, actual, strippedImageWrapper: false };
  return { expected, actual: trimHtml(wrapper.remainder), strippedImageWrapper: true };
}

export function extractAuditableExternalLinks(
  html: string,
  options: { stripLeadingBloggerImageWrapper: boolean }
): string[] {
  const wrapper = options.stripLeadingBloggerImageWrapper
    ? leadingWrapper(trimHtml(html))
    : undefined;
  const source = wrapper?.remainder ?? html;
  return [
    ...new Set(
      [...source.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)]
        .map((match) => match[1].trim())
        .filter((href) => /^https:\/\//i.test(href))
    )
  ].sort();
}
