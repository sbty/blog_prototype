# ADR 0001: Phase 1 foundation and dry-run first

## Status

Accepted

## Context

The PRD requires the system to be implemented from Phase 1 onward, but also requires Blogger dry-run to be completed before enabling draft save or scheduled publish. The repository started empty.

## Decision

Implement a minimal TypeScript foundation with SQLite, config validation, logging, job lifecycle, STOP checks, and a CLI. Add Blogger dry-run as a guarded browser workflow that fills the editor and captures evidence but never saves, publishes, or confirms scheduling.

Dry-run refuses to execute when publish-capable feature flags are enabled.

## Consequences

- Later phases can reuse the same job, artifact, and repository structure.
- Blogger selectors are isolated in configuration because Blogger UI labels and DOM shape can change.
- The initial implementation requires Playwright and a signed-in browser profile for real Blogger dry-runs.
