# ADR 0002: Phase 2 guarded Blogger draft save

## Status

Accepted

## Context

Phase 2 must save Blogger drafts without enabling publication or confirming scheduled posts. Browser automation can be interrupted, redirected to another blog, produce duplicate drafts, or report success without durable evidence.

## Decision

The `save-draft` workflow is fail-closed and requires `ENABLE_DRAFT_SAVE=true` together with `ENABLE_SCHEDULED_POST=false`.

Before saving, the workflow audits exact-title matches and refuses to continue when multiple draft edit URLs are found. It checks the STOP file at job start, immediately before browser mutation, and before an explicit save click.

A job reaches `DRAFT_SAVED` only after all of the following checks pass:

- the returned URL is an HTTPS Blogger persisted edit URL without credentials, query, or fragment;
- its blog ID matches the configured admin or editor URL when an ID is available;
- `savedAt` is a canonical UTC ISO-8601 timestamp;
- the screenshot resolves under the job's `screenshots/` directory, has a `.png` extension, and has a valid PNG signature.

The pre-save audit and validated save result are written to job events and artifacts. Publish and schedule-confirmation controls are never clicked by this workflow.

## Consequences

- Ambiguous duplicate drafts require operator review instead of automatic selection.
- A missing or misplaced screenshot makes the job fail even if Blogger displayed a saved indicator.
- Draft saving performs an additional Blogger list-page visit for the duplicate audit.
- Scheduled publication remains disabled and must be implemented as a separate guarded phase.