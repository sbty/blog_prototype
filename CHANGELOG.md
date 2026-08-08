# Changelog

All notable changes to this project are documented in this file.

## Unreleased

No changes yet.

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

[0.1.0]: https://github.com/sbty/blog_prototype/releases/tag/v0.1.0
