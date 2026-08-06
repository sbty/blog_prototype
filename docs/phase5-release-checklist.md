# Phase 5 dedicated-test-blog release checklist

## Local release gate

- [x] Scoped formatting passes.
- [x] ESLint passes.
- [x] TypeScript build passes.
- [x] All 33 test files and 292 tests pass.
- [x] Compiled scheduled-execution boundary verification passes.
- [x] Production dependency audit reports zero known vulnerabilities.
- [x] Repository secret scan finds no credential-shaped value outside ignored runtime data; the only match is a logger redaction test fixture.
- [x] `.env`, `data`, `dist`, and `node_modules` are ignored.
- [x] Runtime mutation flags are restored to `ENABLE_DRAFT_SAVE=false` and `ENABLE_SCHEDULED_POST=false`.
- [x] The authorized Blogger blog ID is stored only in ignored local configuration and missing configuration fails closed.
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

## Explicitly outside this release

- another save, schedule, publish, repair, rename, or delete operation;
- another Blogger blog or production credentials;
- unattended publication or generalized rollout;
- unbounded retries or deletion of attempt/resume evidence;
- enabling a recurring OS task.

These items are not release defects. They are deliberately excluded capabilities and require separate authorization and acceptance criteria.

## Version-control handoff

The working tree has not been staged or committed by this process. Review the complete initial file set, then create a version-control snapshot separately if desired. Do not include `.env`, `data`, `dist`, or `node_modules`.
