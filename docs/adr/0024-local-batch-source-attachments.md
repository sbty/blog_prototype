# ADR 0024: Local batch source attachments

## Status

Accepted as a Phase 7 capability.

## Context

Legacy or manually assembled article batches can contain complete article text and images but lack the provenance required by the content audit. Fixing this directly in Blogger would bypass the local validation boundary and would be difficult to repeat safely across many blogs.

## Decision

Add the local-only `attach-batch-sources` command. It requires an exact one-to-one assignment for every batch item, rejects credentialed or non-HTTPS URLs, refuses to overwrite existing provenance, and writes a new batch file instead of modifying either input.

The command adds provenance metadata and a visible `official-sources` section whose links exactly match that metadata. It does not open Blogger, use the database, contact an AI provider, save drafts, schedule posts, or publish content.

## Consequences

- Existing batches can be remediated and audited before any external mutation.
- Every provenance URL becomes a visible citation, so the content audit can verify it mechanically.
- Partial assignments and silent provenance replacement are rejected.
- Updating an already-saved Blogger draft remains a separate, explicitly authorized operation.
