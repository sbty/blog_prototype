import { extractBloggerBlogId, extractBloggerPostId } from "../browser/bloggerEditorIdentity.js";
import type { ExistingDraftAuditSelectionPreparationManifest } from "../domain/existingDraftAuditSelectionPreparation.js";

type SourceItem = ExistingDraftAuditSelectionPreparationManifest["items"][number];
export interface ExistingDraftAuditSelectionPreparationResult {
  schemaVersion: 1;
  operation: "prepare-existing-draft-audit-selection";
  status: "READY" | "NO_VALID_LOCAL_CANONICAL";
  counts: { input: number; valid: number; excluded: number };
  exclusions: Array<{
    batch: string;
    blogKey: string;
    slug: string;
    postId: string;
    reason: string;
  }>;
  selectionManifest: {
    schemaVersion: 1;
    operation: "select-existing-draft-audit-targets";
    items: Array<
      Pick<SourceItem, "batch" | "blogPath" | "articlePath" | "postId" | "postEditorUrl" | "slug">
    >;
  };
  provenance: Array<
    Pick<
      SourceItem,
      "batch" | "blogKey" | "slug" | "title" | "postId" | "scheduledAtJst" | "provenance"
    >
  >;
}

export class ExistingDraftAuditSelectionPreparationService {
  execute(
    manifest: ExistingDraftAuditSelectionPreparationManifest,
    evidenceIssues = new Map<string, string>()
  ): ExistingDraftAuditSelectionPreparationResult {
    const exclusions: ExistingDraftAuditSelectionPreparationResult["exclusions"] = [];
    const valid: SourceItem[] = [];
    const grouped = new Map<string, SourceItem[]>();
    for (const item of manifest.items) {
      const key = `${item.blogKey}\0${item.slug}`;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    for (const item of manifest.items) {
      const key = `${item.blogKey}\0${item.slug}`;
      const exclude = (reason: string) =>
        exclusions.push({
          batch: item.batch,
          blogKey: item.blogKey,
          slug: item.slug,
          postId: item.postId,
          reason
        });
      const evidenceIssue = evidenceIssues.get(key);
      if (evidenceIssue) {
        exclude(evidenceIssue);
        continue;
      }
      if ((grouped.get(key)?.length ?? 0) !== 1) {
        exclude("Multiple local canonicals share the same blogKey and slug");
        continue;
      }
      if (
        item.evidence.save !== "PASS" ||
        item.evidence.reservation !== "PASS" ||
        item.evidence.readiness !== "PASS"
      ) {
        exclude("Save, reservation, or readiness evidence is contradictory");
        continue;
      }
      if (extractBloggerPostId(item.postEditorUrl) !== item.postId) {
        exclude("Editor URL post ID does not match the local canonical post ID");
        continue;
      }
      if (!extractBloggerBlogId(item.postEditorUrl)) {
        exclude("Editor URL does not contain a Blogger blog ID");
        continue;
      }
      if (!item.blogPath || !item.articlePath) {
        exclude("Local blog or article reference is missing");
        continue;
      }
      valid.push(item);
    }
    const postIds = new Set<string>();
    const unique = valid.filter((item) => {
      if (postIds.has(item.postId)) {
        exclusions.push({
          batch: item.batch,
          blogKey: item.blogKey,
          slug: item.slug,
          postId: item.postId,
          reason: "Post ID is duplicated by another local canonical"
        });
        return false;
      }
      postIds.add(item.postId);
      return true;
    });
    return {
      schemaVersion: 1,
      operation: "prepare-existing-draft-audit-selection",
      status: unique.length ? "READY" : "NO_VALID_LOCAL_CANONICAL",
      counts: { input: manifest.items.length, valid: unique.length, excluded: exclusions.length },
      exclusions,
      selectionManifest: {
        schemaVersion: 1,
        operation: "select-existing-draft-audit-targets",
        items: unique.map(({ batch, blogPath, articlePath, postId, postEditorUrl, slug }) => ({
          batch,
          blogPath,
          articlePath,
          postId,
          postEditorUrl,
          slug
        }))
      },
      provenance: unique.map(
        ({ batch, blogKey, slug, title, postId, scheduledAtJst, provenance }) => ({
          batch,
          blogKey,
          slug,
          title,
          postId,
          scheduledAtJst,
          provenance
        })
      )
    };
  }
}
