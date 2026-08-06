# ADR 0003: Local-only schedule planning and approval

## Status

Accepted

## Context

Scheduled posting is a higher-risk capability than draft saving. A single feature flag or stale approval must not be sufficient to mutate Blogger. Plans can become unsafe after creation because time passes, quotas change, artifacts are edited, or an operator decides to cancel.

## Decision

Phase 3 begins with a guarded workflow. Every command requires `ENABLE_SCHEDULED_POST=false`. Only the approved browser-preview command opens Blogger, and it blocks non-read-only network requests before navigation:

1. `plan-schedule` validates the timestamp and current system/blog quota, then creates `READY_FOR_POST`.
2. `approve-schedule` requires the job ID to be repeated exactly and creates `APPROVED_FOR_POST`.
3. Approval records the SHA-256 of the exact plan bytes.
4. `check-schedule` verifies the job, approval, plan hash, database schedule, future-time margin, STOP file, and current quota. It explicitly records `executionEnabled=false`.
5. `preview-approved-schedule` reruns readiness checks, opens the correct Blogger editor, blocks non-read-only requests, and validates its screenshot and network-guard evidence without changing job status.
6. `confirm-schedule-preview` requires the exact job ID and SHA-256 of the browser-preview artifact, revalidates the full approval/evidence chain, and creates `PREVIEW_CONFIRMED` without execution authority.
7. `cancel-schedule` moves `READY_FOR_POST`, `APPROVED_FOR_POST`, or `PREVIEW_CONFIRMED` to `CANCELLED` and releases its quota.

Environment booleans, positive integer limits, quality-score ranges, confidence, and the IANA timezone are validated at startup.

Plan, approval, readiness, browser-preview, and confirmation artifacts are validated with strict schemas and SHA-256 bindings. Their job IDs and timestamps must form one consistent chain. STOP is checked at command entry and again immediately before each local artifact or state transition. Browser-preview URLs, blocked-request telemetry, and PNG screenshot evidence are validated before they are recorded.

## Consequences

- Local approval is necessary but is not authority to publish or confirm a Blogger schedule.
- Editing a plan after approval invalidates readiness.
- Approved plans continue consuming quota until cancelled or a future terminal execution status is introduced.
- Browser preview may read Blogger state but cannot save, publish, or confirm a schedule because mutation methods are blocked.
- `PREVIEW_CONFIRMED` confirms reviewed evidence only; it keeps `executionEnabled=false` and grants no Blogger mutation authority.
- A separate decision and implementation are required before any Blogger schedule confirmation is enabled.