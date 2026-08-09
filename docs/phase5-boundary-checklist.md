# Phase 5 dedicated-test-blog execution-boundary checklist

## Completed safety boundary

- [x] Require job ID, exact confirmation, package SHA-256, and audit SHA-256.
- [x] Restrict execution to Blogger blog IDs in the ignored local allowlist; live acceptance covers exactly two dedicated test blogs.
- [x] Require `ENABLE_SCHEDULED_POST=true` and `ENABLE_DRAFT_SAVE=false`.
- [x] Recheck STOP and require the approved time to remain in the future.
- [x] Read the Blogger public feed before any attempt marker or browser mutation and require its observed UTC offset to match `APP_TIMEZONE`.
- [x] Validate the sealed package and independent audit evidence chain.
- [x] Write an exclusive execution-attempt marker before mutation.
- [x] Permit at most one evidence-identical interrupted-attempt resume.
- [x] Upload the configured image before publish confirmation.
- [x] Keep scheduled execution and draft saving mutually exclusive.
- [x] Verify compiled boundary invariants with `npm run verify:execution-boundary`.
- [x] Run scoped formatting, lint, build, all tests, and compiled checks with `npm run verify:local-complete`.
- [x] Provide `audit-published-post` to recheck exactly one public title match, nonempty content, one image, and an HTTP 200 nonempty image without Blogger mutation.
- [x] Document authentication, failure, duplicate, image, timezone, STOP, and evidence-recovery procedures.
- [x] Document a disabled recurring read-only audit example without providing unattended publication.

## Acceptance result

- [x] One dedicated-test-blog post was scheduled manually and later observed as published.
- [x] A second explicitly authorized post completed the full automated image-plus-schedule-confirmation path and was independently observed as exactly one scheduled post.
- [x] One explicitly authorized two-blog batch scheduled one existing draft per dedicated test blog for `2026-08-10 02:45 JST`; both items succeeded and both posts were observed publicly.
- [x] Exactly one image was inserted into the same post.
- [x] The public feed contained the matching title and one image.
- [x] The public image returned HTTP 200.
- [x] Safety flags were restored to `ENABLE_DRAFT_SAVE=false` and `ENABLE_SCHEDULED_POST=false`.
- [x] Live feed validation observed `+09:00` and matched `APP_TIMEZONE=Asia/Tokyo` for both accepted blogs; the empty-blog case used the feed-level update timestamp.

## Still not authorized

- [ ] Another post or a third Blogger blog.
- [ ] Unbounded retries or removal of exclusive attempt markers.
- [ ] Production credentials or generalized rollout.
- [ ] Treating local evidence as execution permission without explicit authorization.
- [ ] Scheduling while the Blogger feed offset differs from `APP_TIMEZONE`; correct Blogger's timezone setting first.

See ADR 0006 for the original single-blog acceptance and ADR 0016 for the bounded two-blog acceptance.
