# ADR 0025: Guarded live draft source updates

## Status

Accepted as a Phase 7 capability.

## Context

Attaching provenance to a local content batch does not repair an existing Blogger draft. Manually replacing the full post body risks losing an uploaded image, changing unrelated settings, or creating duplicate source sections.

## Decision

Add `update-draft-sources --manifest <path>` as a narrowly scoped live mutation command. The input must be a `save-drafts` batch whose articles already contain one audited `official-sources` section and matching provenance.

Before the first mutation, the command checks every target draft, exact title, editor identity, authorization allowlist, and current HTML. It then updates only the HTML body, preserves the live image markup, saves through Blogger's draft menu, reloads the editor, and verifies the title, image, source count, and cited URLs. Existing matching sections are idempotent, while recognized trailing duplicate corruption is reduced to one section.

The command requires `ENABLE_DRAFT_SAVE=true`, requires `ENABLE_SCHEDULED_POST=false`, supports one existing post per blog in a run, honors the STOP file, and never clicks Publish or changes scheduling controls.

## Consequences

- Multi-blog source remediation is repeatable without replacing titles, images, or post settings.
- Targets outside `AUTHORIZED_TEST_BLOG_ID` and `AUTHORIZED_BLOG_IDS` are rejected.
- A concurrent body change detected after preflight stops the run instead of overwriting it.
- Each successful run produces a JSON report and per-item screenshot artifacts.
