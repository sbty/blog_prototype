import { describe, expect, it } from "vitest";
import { existingDraftAuditSelectionPreparationManifestSchema } from "../domain/existingDraftAuditSelectionPreparation.js";
import { ExistingDraftAuditSelectionPreparationService } from "../services/existingDraftAuditSelectionPreparationService.js";

const item = {
  batch: "initial",
  blogKey: "blog-1",
  slug: "article-1",
  title: "記事",
  blogPath: "blog.json",
  articlePath: "article.json",
  postId: "2222222222",
  postEditorUrl: "https://www.blogger.com/blog/post/edit/1111111111/2222222222",
  scheduledAtJst: "2026-09-01 09:00 JST",
  provenance: {
    generationPackage: "generation.json",
    saveAudit: "save.json",
    reservationAudit: "schedule.json",
    readinessAudit: "readiness.json"
  },
  evidence: { save: "PASS", reservation: "PASS", readiness: "PASS" }
};
function run(items = [item]) {
  return new ExistingDraftAuditSelectionPreparationService().execute(
    existingDraftAuditSelectionPreparationManifestSchema.parse({
      schemaVersion: 1,
      operation: "prepare-existing-draft-audit-selection",
      items
    })
  );
}

describe("ExistingDraftAuditSelectionPreparationService", () => {
  it("builds the downstream selection manifest and preserves local provenance", () => {
    const result = run();
    expect(result.status).toBe("READY");
    expect(result.selectionManifest.items).toHaveLength(1);
    expect(result.provenance[0]).toMatchObject({
      batch: "initial",
      slug: "article-1",
      postId: "2222222222"
    });
  });
  it("excludes duplicate local canonicals", () => {
    const result = run([item, { ...item, batch: "next" }]);
    expect(result.status).toBe("NO_VALID_LOCAL_CANONICAL");
    expect(result.exclusions[0].reason).toContain("Multiple local canonicals");
  });
  it("excludes duplicate post IDs", () => {
    const result = run([item, { ...item, blogKey: "blog-2", slug: "article-2" }]);
    expect(result.selectionManifest.items).toHaveLength(1);
    expect(result.exclusions[0].reason).toContain("Post ID");
  });
  it("excludes editor URL post-ID mismatches", () => {
    const result = run([
      { ...item, postEditorUrl: "https://www.blogger.com/blog/post/edit/1111111111/3333333333" }
    ]);
    expect(result.exclusions[0].reason).toContain("post ID");
  });
  it("rejects missing local references at the input boundary", () => {
    expect(() => run([{ ...item, blogPath: "" }])).toThrow();
  });
  it("rejects contradictory reservation evidence at the input boundary", () => {
    expect(() => run([{ ...item, evidence: { ...item.evidence, reservation: "FAIL" } }])).toThrow();
  });
  it("excludes a canonical whose referenced local evidence is missing", () => {
    const result = new ExistingDraftAuditSelectionPreparationService().execute(
      existingDraftAuditSelectionPreparationManifestSchema.parse({
        schemaVersion: 1,
        operation: "prepare-existing-draft-audit-selection",
        items: [item]
      }),
      new Map([
        [
          "blog-1\0article-1",
          "Local generation, save, reservation, or readiness evidence file is missing or unreadable"
        ]
      ])
    );
    expect(result.exclusions[0].reason).toContain("missing or unreadable");
  });
  it("creates a valid empty downstream selection manifest", () => {
    const result = run([]);
    expect(result).toMatchObject({
      status: "NO_VALID_LOCAL_CANONICAL",
      counts: { input: 0, valid: 0, excluded: 0 },
      selectionManifest: { items: [] }
    });
  });
});
