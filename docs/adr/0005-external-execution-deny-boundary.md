# ADR 0005: Deny external scheduled-post execution

## Status

Accepted as the initial Phase 5 safety boundary.

## Context

Phase 4 produces and audits local evidence, but neither artifact grants authority to mutate Blogger. Exposing a future-looking command name without an explicit implementation boundary could allow an operator or later change to mistake evidence completeness for execution permission.

## Decision

Reserve the `execute-schedule` CLI shape and make it fail closed unconditionally.

The command requires explicit job, confirmation, package SHA-256, and audit SHA-256 arguments so the future contract is visible. A minimal CLI launcher parses arguments and immediately calls a dependency-free denial boundary before dynamically importing the operational CLI. The compiled argument parser is dependency- and runtime-capability-free and pinned by SHA-256, so contract changes require an explicit boundary review. Browser, database, environment configuration, and logger modules remain outside the denied execution path. The boundary always reports that scheduled-post execution is not implemented or authorized and that Blogger mutation remains disabled. Built-artifact verification pins its complete normalized function body to input disposal followed immediately by the fixed error, so extra behavior or side effects fail verification.

It does not:

- import or open browser operational modules;
- load or mutate the database;
- read credentials or evidence artifacts;
- inspect `ENABLE_SCHEDULED_POST` as a bypass;
- schedule, save, or publish a Blogger post.

## Consequences

Local tooling has an explicit tripwire against accidental external execution. Replacing this denial boundary requires separate user authorization, a new ADR, acceptance criteria, threat review, integration tests, and controlled rollout. Phase 4 evidence remains non-authoritative. A built-artifact verifier inspects the compiled launcher, dependency-free argument parser, and denial module, then runs help and the denied command under deliberately invalid configuration with both mutation flags set to true. This verifies import isolation, fail-closed behavior, and that environment flags cannot bypass denial.
