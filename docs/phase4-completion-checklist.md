# Phase 4 local execution-boundary checklist

## Completed local-only scope

- [x] Prepare a sealed execution-candidate package only from `PREVIEW_CONFIRMED`.
- [x] Require exact job-ID confirmation and caller-supplied evidence SHA-256 values.
- [x] Revalidate strict schemas for the plan, approval, readiness, browser preview, preview confirmation, package, and audit attestation.
- [x] Bind plan, approval, preview, confirmation, screenshot, package, and audit artifacts through SHA-256.
- [x] Read core evidence only from regular files that physically resolve inside the job artifact directory from approval through audit; reject path components and outside junction targets.
- [x] Validate and hash screenshot evidence from bytes read through the same verified file handle, preventing path or link swaps between validation and hashing.
- [x] Recompute every plan's local date and time from `scheduledAt` and its IANA timezone, then require browser-preview values to match that validated plan through one shared fail-closed validator.
- [x] Require plan quota counts to be below their limits and readiness quota counts to be at or below their limits.
- [x] Bind readiness system/blog quota limits to the approved plan limits through one shared validator used by confirmation, package preparation, and audit.
- [x] Enforce one shared nondecreasing timestamp chain from approval through readiness, preview, confirmation, preparation, and audit; reject evidence at or after the scheduled time.
- [x] Require `executionEnabled=false`, `executionAuthorized=false`, and `bloggerMutationPerformed=false` at every readiness, preview, confirmation, package, and audit stage.
- [x] Write package and audit artifacts exclusively so existing sealed evidence cannot be overwritten.
- [x] Require fixed `artifactType` values and `schemaVersion=1` for preview confirmation, execution package, and audit attestation.
- [x] Recheck STOP at entry and immediately before local artifact or audit-event recording.
- [x] Leave the job in `PREVIEW_CONFIRMED`; package preparation and audit grant no new state or authority.
- [x] Provide `npm run verify:phase4` for lint, build, and complete tests.

## Dedicated acceptance exception and remaining exclusions

- [x] One explicitly authorized dedicated-test-blog post was scheduled, published, and audited; image insertion was verified separately.
- [x] A browser executor exists only behind the ignored local blog-ID allowlist, evidence hashes, STOP, feature flags, and exclusive attempt/resume markers; live acceptance remains dedicated-blog-only.
- [x] `ENABLE_SCHEDULED_POST` was enabled only in the accepted process and restored to false.
- [ ] Production credentials, retries beyond the evidence-identical bounded resume, or production rollout.
- [ ] A state transition that represents external execution authority or completion.

ADR 0006 records the narrow acceptance exception. The local Phase 4 artifacts alone must never be interpreted as permission to mutate Blogger.
