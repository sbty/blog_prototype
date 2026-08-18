import { describe, expect, it } from "vitest";
import { prepareOfficialSourcesHtml } from "../browser/bloggerDraftSources.js";

const url = "https://example.com/official";
const section = `<section class="official-sources"><h2>Official</h2><ul><li><a href="${url}">Source</a></li></ul></section>`;

describe("prepareOfficialSourcesHtml", () => {
  it("inserts the source section before an article closing tag", () => {
    expect(prepareOfficialSourcesHtml("<article><p>Body</p></article>", section, [url])).toEqual({
      html: `<article><p>Body</p>${section}</article>`,
      changed: true
    });
  });

  it("appends the source section to wrapperless Blogger HTML", () => {
    expect(prepareOfficialSourcesHtml("<h2>Body</h2><p>Text</p>", section, [url])).toEqual({
      html: `<h2>Body</h2><p>Text</p>${section}`,
      changed: true
    });
  });

  it("keeps one valid section and removes trailing duplicate corruption", () => {
    const valid = `<article><p>Body</p>${section}</article>`;
    expect(
      prepareOfficialSourcesHtml(
        `${valid}${section}<section class="official-sources">partial`,
        section,
        [url]
      )
    ).toEqual({
      html: valid,
      changed: true
    });
  });

  it("is idempotent when one matching section is already present", () => {
    const html = `<article><p>Body</p>${section}</article>`;
    expect(prepareOfficialSourcesHtml(html, section, [url])).toEqual({ html, changed: false });
  });

  it("rejects a mismatched existing source section", () => {
    expect(() =>
      prepareOfficialSourcesHtml(
        '<article><section class="official-sources"><a href="https://example.com/other">Other</a></section></article>',
        section,
        [url]
      )
    ).toThrow("Existing official source section does not match provenance");
  });
});
