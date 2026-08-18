# Phase 6 v0.3.0 release checklist

## Local release candidate

- [x] Package and lockfile versions are `0.3.0`.
- [x] The changelog records the Phase 6 feature and security boundaries under `0.3.0`.
- [x] Phase 6 completion criteria and explicit exclusions are documented.
- [x] `npm run verify:phase6` is the reproducible complete local gate.
- [x] Blogger mutation flags remain disabled in ignored local configuration after acceptance work.
- [x] Article generation remains disabled by default and no API key is stored in version control.
- [x] Public examples contain only fictional Blogger identifiers and placeholder source URLs.
- [x] Runtime data, generated images, browser profiles, credentials, `dist`, and dependencies remain ignored.

## Required before publishing v0.3.0

- [x] Pull request checks, Node.js 24 compatibility, and CodeQL pass on the final release commit.
- [x] Production and development dependency audits report zero known vulnerabilities.
- [x] `main` is clean and matches `origin/main` after the release-preparation pull request is merged.
- [x] The maintainer explicitly approves creation of the `v0.3.0` tag and GitHub release.

## Release scope

v0.3.0 adds a guarded local content pipeline from article routing and AI generation contracts through provenance-preserving, image-bearing multi-blog batch compilation. It does not grant authority to run a batch against Blogger, enable unattended generation or posting, discover or verify web sources, generate images, or expand the existing allowlisted test-blog execution scope.
