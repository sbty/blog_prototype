# ADR 0028: Local content remediation packages

## Status

Accepted as a Phase 7 capability.

## Context

A retry batch isolates failed articles but does not explain their audit failures to an AI correction step. Sending the original batch directly would also expose Blogger administration URLs, editor URLs, blog IDs, local image paths, and scheduling data that the model does not need.

## Decision

Add `prepare-content-remediation-package --manifest <path> --audit <path> --output <path>`.

The command reuses the strict retry alignment checks and exports one request per failed article. Each request contains a sanitized editorial profile, the editable article fields, available provenance URLs, audit metrics and issues, correction rules, and a response contract. Blogger identity, administrator and editor URLs, local image paths, and scheduled timestamps are excluded.

When provenance is absent, the package marks `requiresSourceResearch=true` instead of inventing a source. Image paths and scheduled timestamps are explicitly preserved out of band for a later validated import step.

The command only writes a new local JSON file. It does not call an AI provider, open Blogger, use the database, or overwrite either input.

## Consequences

- Failed content can be corrected with the exact audit context and editorial constraints.
- Provider payloads do not receive Blogger account identity or local filesystem details.
- Slugs remain stable so corrected content can be matched back to the retry batch.
- A separate import capability is required before corrected responses can replace retry articles.
