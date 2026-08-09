# Phase 5 dedicated-test-blog release checklist

## Local release gate

- [x] Scoped formatting passes.
- [x] ESLint passes.
- [x] TypeScript build passes.
- [x] All 43 test files and 361 tests pass.
- [x] Compiled scheduled-execution boundary verification passes.
- [x] A clean shallow clone can run `npm ci` and the complete local gate without local runtime data.
- [x] Production and development dependency audits report zero known vulnerabilities.
- [x] Repository secret scan finds no credential-shaped value outside ignored runtime data; the only match is a logger redaction test fixture.
- [x] `.env`, `data`, `dist`, and `node_modules` are ignored.
- [x] Runtime mutation flags are restored to `ENABLE_DRAFT_SAVE=false` and `ENABLE_SCHEDULED_POST=false`.
- [x] Authorized Blogger blog IDs are stored only in ignored local configuration and missing configuration fails closed.
- [x] `APP_TIMEZONE=Asia/Tokyo` matches the accepted dedicated-blog feed offset.
- [x] Public post audit finds exactly one title match and one valid Blogger-hosted image.
- [x] Authentication, failure, duplicate, image, timezone, STOP, and evidence recovery are documented.
- [x] Any recurring audit example is read-only and initially disabled.

Run the reproducible local gate with:

```powershell
npm run verify:local-complete
```

## Completed acceptance scope

The locally configured dedicated test blog has accepted the guarded draft-save workflow and the guarded image-plus-scheduled-post workflow. The scheduled post was observed publicly, and its single image returned HTTP 200 with a nonempty image response.

The current source can prepare, preflight, execute, retry, inspect, and list multiple articles across an explicit local blog-ID allowlist. That implementation and its automated tests do not expand this release acceptance: no second Blogger blog has completed live acceptance.

## Explicitly outside this release

- another save, schedule, publish, repair, rename, or delete operation;
- another Blogger blog or production credentials;
- unattended publication or generalized rollout;
- unbounded retries or deletion of attempt/resume evidence;
- enabling a recurring OS task.

These items are not release defects. They are deliberately excluded capabilities and require separate authorization and acceptance criteria.

## Version-control and release handoff

- The source is committed to the protected `main` branch of `sbty/blog_prototype`; changes require a pull request and successful required checks.
- [`v0.1.0`](https://github.com/sbty/blog_prototype/releases/tag/v0.1.0) is the guarded stable release snapshot of the completed dedicated-test-blog acceptance scope. Later repository-hardening changes do not expand Blogger execution authority.
- Any future release or scope expansion is a separate maintainer decision. Review the current release scope, successful CI and code-scanning results, and the exclusions above before publishing it.
- `.env`, `data`, `dist`, and `node_modules` remain ignored and must not be committed. Local evidence and credentials remain outside version control.
