# ADR 0026: Content audit gate before draft batches

## Status

Accepted as a Phase 7 capability.

## Context

The local content audit was available as an optional command, so a caller could still invoke `run-batch` with `save-drafts` and bypass the editorial checks. In a multi-blog system, one weak item could therefore reach Blogger before another item exposed the batch's quality problem.

## Decision

Make the content audit a mandatory pre-execution gate for every `run-batch` manifest whose operation is `save-drafts`.

The service validates the complete manifest, checks the STOP boundary and operation flags, creates the batch artifact directory, runs the content audit across every item, and writes `content-audit.json`. If any item fails, the command throws with the audit report path before selecting or invoking a Blogger executor. A passing audit summary is included in the final batch result.

The gate does not change `dry-run` or `plan-schedules`; those operations retain their existing boundaries.

## Consequences

- Draft batches cannot bypass provenance, citation, target length, image, description, and excluded-topic checks.
- A failing batch leaves durable local evidence while producing zero Blogger mutations.
- All items must pass before the first draft save begins, regardless of `continueOnError`.
- Existing callers and tests can inject an auditor, while production uses the real content audit service by default.
