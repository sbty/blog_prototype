# ADR 0029: Local content remediation import

## Status

Accepted as a Phase 7 capability.

## Context

ADR 0028 exports failed articles and audit findings without operational Blogger data. Corrected responses must be matched back to the exact source articles without allowing a provider to alter image paths, scheduling timestamps, blog routing, or stable slugs.

## Decision

Add `import-content-remediations --manifest <path> --package <path> --responses <path> --output <path>`.

The command validates a complete, unique response set against the remediation package and the current source batch. It rejects unknown or missing IDs, changed slugs, active HTML, mismatched provided sources, stale source articles, and provider-supplied operational fields.

The output contains only corrected failed articles. It restores each original image path, scheduled timestamp, blog assignment, generation request ID, and batch execution policy out of band. When an original generation request ID is absent, the remediation ID becomes the new provenance ID. Attested source URLs become the corrected article provenance so the ordinary content audit can verify their citations.

The command only writes a new local JSON file and refuses to overwrite an input. It does not call an AI provider, Blogger, or the database. The output must pass `audit-content-batch` before `run-batch` can save it.

## Consequences

- Corrected content enters the existing batch contract through a strict local boundary.
- Provider responses cannot redirect a correction to another blog or change operational metadata.
- Source batches changed after export fail closed instead of receiving stale corrections.
- A successful import is not approval to save; the content audit remains mandatory.
