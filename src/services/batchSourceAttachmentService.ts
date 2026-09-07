import { batchManifestSchema, type BatchManifest } from "../domain/batch.js";
import { batchSourceAssignmentsSchema } from "../domain/batchSources.js";

export interface AttachedBatchSources {
  blogKey: string;
  slug: string;
  generationRequestId: string;
  sourceCount: number;
}

export interface BatchSourceAttachmentResult {
  manifest: BatchManifest;
  sources: AttachedBatchSources[];
}

function itemKey(blogKey: string, slug: string): string {
  return `${blogKey}\0${slug}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function appendSourceSection(
  html: string,
  heading: string,
  sources: Array<{ title: string; url: string }>
): string {
  const links = sources
    .map(
      (source) =>
        `<li><a href="${escapeHtml(new URL(source.url).href)}">${escapeHtml(source.title)}</a></li>`
    )
    .join("");
  const section = `<section class="official-sources"><h2>${escapeHtml(heading)}</h2><ul>${links}</ul></section>`;
  const articleEnd = html.match(/<\/article\s*>\s*$/i);
  if (!articleEnd || articleEnd.index === undefined) return `${html}${section}`;
  return `${html.slice(0, articleEnd.index)}${section}${html.slice(articleEnd.index)}`;
}

function sameSourceUrls(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const normalizedLeft = new Set(left.map((url) => new URL(url).href));
  const normalizedRight = new Set(right.map((url) => new URL(url).href));
  return (
    normalizedLeft.size === normalizedRight.size &&
    [...normalizedLeft].every((url) => normalizedRight.has(url))
  );
}

export class BatchSourceAttachmentService {
  execute(batchInput: unknown, assignmentsInput: unknown): BatchSourceAttachmentResult {
    const batch = batchManifestSchema.parse(batchInput);
    const assignments = batchSourceAssignmentsSchema.parse(assignmentsInput);
    const expectedKeys = new Set(
      batch.items.map((item) => itemKey(item.blogKey, item.article.slug))
    );
    const assignmentsByKey = new Map(
      assignments.items.map((item) => [itemKey(item.blogKey, item.slug), item])
    );

    const unexpected = assignments.items.filter(
      (item) => !expectedKeys.has(itemKey(item.blogKey, item.slug))
    );
    if (unexpected.length > 0) {
      throw new Error(
        `Source assignments contain unknown batch items: ${unexpected
          .map((item) => `${item.blogKey}/${item.slug}`)
          .join(", ")}`
      );
    }

    const missing = batch.items.filter(
      (item) => !assignmentsByKey.has(itemKey(item.blogKey, item.article.slug))
    );
    if (missing.length > 0) {
      throw new Error(
        `Source assignments are missing batch items: ${missing
          .map((item) => `${item.blogKey}/${item.article.slug}`)
          .join(", ")}`
      );
    }

    const items = batch.items.map((item) => {
      const assignment = assignmentsByKey.get(itemKey(item.blogKey, item.article.slug))!;
      const sourceUrls = assignment.sources.map((source) => new URL(source.url).href);
      if (
        item.provenance &&
        (item.provenance.generationRequestId !== assignment.generationRequestId ||
          !sameSourceUrls(item.provenance.sourceUrls, sourceUrls))
      ) {
        throw new Error(
          `Source assignment does not match existing provenance: ${item.blogKey}/${item.article.slug}`
        );
      }
      return {
        ...item,
        article: {
          ...item.article,
          html: appendSourceSection(
            item.article.html,
            assignments.sectionHeading,
            assignment.sources
          )
        },
        provenance: item.provenance ?? {
          generationRequestId: assignment.generationRequestId,
          sourceUrls
        }
      };
    });
    const manifest = batchManifestSchema.parse({ ...batch, items });

    return {
      manifest,
      sources: items.map((item) => ({
        blogKey: item.blogKey,
        slug: item.article.slug,
        generationRequestId: item.provenance.generationRequestId,
        sourceCount: item.provenance.sourceUrls.length
      }))
    };
  }
}
