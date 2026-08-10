# Changelog

All notable changes to this project are documented in this file.

## Unreleased

## [0.2.0] - 2026-08-11

### Added

- Added prevalidated sequential batch execution for multiple blogs and articles, with durable result reports, partial-failure handling, fail-fast mode, and STOP-aware skipping.
- Added a fail-closed, all-items execution preflight before any scheduled batch artifact or Blogger mutation.
- Added exact retry manifests for failed and skipped schedule approval, preparation, and execution batch items.
- Added read-only schedule-batch inspection with strict result and companion-manifest validation.
- Added a read-only, newest-first schedule-batch list with isolated invalid-result reporting.
- Added empty-blog timezone validation using the feed-level update timestamp, while preserving published-entry validation.
- Added a sanitized PC/gadget/desk blog configuration example and a responsive geek-style Blogger theme.

### Changed

- Completed one explicitly authorized two-blog acceptance batch with one existing draft per dedicated test blog; both items were scheduled for the same JST time and observed publicly.
- Recorded the bounded acceptance in ADR 0016 without expanding authority to additional blogs, posts, unattended publication, or production.

### Security

- Prevented repeated batch runs from creating a second draft when one matching Blogger draft already exists.
- Pinned GitHub Actions dependencies to verified full commit SHAs while retaining Dependabot version tracking.

## [0.1.1] - 2026-08-08

### Added

- Structured bug and feature request forms that require redaction and classify Blogger mutation impact.
- Node.js 24 LTS compatibility verification alongside the required Node.js 22 LTS safety gate.
- Repository status links, release handoff documentation, and a maintained changelog.

### Changed

- Updated Playwright, TypeScript ESLint, better-sqlite3, ESLint, tsx, and better-sqlite3 type definitions within their supported ranges.
- Updated dotenv to 17.4.2, pino to 10.3.1, and zod to 4.4.3 with explicit nested configuration defaults.
- Declared support for Node.js 22 LTS and 24 LTS.
- Deferred TypeScript 7 until it is supported by typescript-eslint, and kept Node type definitions aligned with the Node.js 22 baseline.

### Security

- Preserved default-off Blogger mutation flags, fail-closed validation, log redaction, required CI, CodeQL, dependency auditing, and the dedicated-test-blog execution boundary.
- This release performs no Blogger mutation and grants no additional save, schedule, publish, repair, rename, or delete authority.

## [0.1.0] - 2026-08-08

### Added

- Guarded Blogger draft-save workflow with screenshots, durable evidence, and duplicate protection.
- Local schedule planning, approval, preview, cancellation, sealed execution packages, and independent audit attestation.
- Dedicated-test-blog scheduled execution boundary with STOP checks, exact evidence hashes, timezone validation, bounded recovery, and one-time execution markers.
- Image upload validation and read-only public post/image audit.
- Operations, acceptance, release, and security documentation.

### Security

- Default-off mutation flags and fail-closed authorization for the locally configured dedicated test blog.
- Protected `main`, required CI, CodeQL, dependency auditing, Dependabot, secret scanning, push protection, and private vulnerability reporting.
- Local credentials, identifiers, runtime evidence, build output, and dependencies remain excluded from version control.

### Limitations

- This release does not authorize another Blogger mutation, another blog, unattended publishing, production rollout, or unbounded retries.
- Expanding the execution scope requires explicit authorization, separate acceptance criteria, a safety review, and an ADR.

[0.2.0]: https://github.com/sbty/blog_prototype/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/sbty/blog_prototype/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/sbty/blog_prototype/releases/tag/v0.1.0
