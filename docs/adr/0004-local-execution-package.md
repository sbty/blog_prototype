# ADR 0004: Local-only schedule execution package

## Status

Accepted for Phase 4 local implementation.

## Context

A confirmed browser preview is evidence that an operator reviewed a non-mutating Blogger editor preview. It is not authority to schedule or publish. Before any future external executor can be considered, the evidence chain needs one immutable, locally generated handoff artifact.

## Decision

Add `prepare-execution-package` for jobs in `PREVIEW_CONFIRMED`.

The command:

- requires an exact job-ID confirmation and the SHA-256 of `schedule-preview-confirmation.json`;
- requires both `ENABLE_DRAFT_SAVE=false` and `ENABLE_SCHEDULED_POST=false`;
- revalidates the plan, approval, readiness, browser preview, screenshot, preview confirmation, hashes, artifact location, and STOP file;
- reads core evidence only from regular files physically contained by the job artifact directory and rejects outside link targets;
- validates the screenshot type and hashes bytes read from the same verified file handle, preventing a path or link swap between those operations;
- applies one shared nondecreasing timestamp chain and requires all local evidence to precede the scheduled time;
- rejects plan quota evidence without an available slot and readiness evidence that exceeds a quota limit;
- requires readiness system/blog quota limits to exactly match the approved plan policy;
- recomputes plan-local date and time from the canonical UTC timestamp and IANA timezone, then requires browser-preview schedule values to match through a shared semantic validator;
- writes `schedule-execution-package.json` exclusively, so an existing package is never overwritten;
- makes confirmation, package, and audit handoff artifacts self-describing with fixed artifact types and `schemaVersion=1`;
- requires `executionEnabled=false`, `executionAuthorized=false`, and `bloggerMutationPerformed=false` in readiness, preview, confirmation, package, and audit evidence; the package also records `requiresExternalExecutionImplementation=true`;
- records an audit event without changing the job from `PREVIEW_CONFIRMED`;
- never opens Blogger and contains no scheduling or publishing implementation.

`audit-execution-package` independently reloads the sealed package and every source artifact, requires the caller-supplied package SHA-256, revalidates the full hash, semantic schedule, and timestamp chain, including that the scheduled time has not passed, and writes one exclusive `schedule-execution-package-audit.json` attestation and records a local audit event. It grants no execution authority and leaves the job in `PREVIEW_CONFIRMED`.

## Consequences

Phase 4 can define and test the handoff boundary without granting mutation authority. A future external executor requires a separate ADR, a separate enablement gate, explicit acceptance criteria, and an additional approval ceremony. The package created here must not be interpreted as permission to mutate Blogger.
