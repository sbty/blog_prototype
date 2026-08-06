# Phase 5 operations runbook

This runbook freezes the completed scope to the locally configured dedicated Blogger test blog. It does not authorize another post, another blog, or unattended publishing.

## Normal safe state

- `ENABLE_DRAFT_SAVE=false`
- `ENABLE_SCHEDULED_POST=false`
- `APP_TIMEZONE=Asia/Tokyo`
- no recurring publish task
- keep `data/STOP` present whenever all browser mutation must be prevented

Verify the local implementation with:

```powershell
npm run verify:local-complete
```

Recheck the accepted public post without changing Blogger with:

```powershell
node dist/cli/index.js audit-published-post --blog examples/blog.example.json --article data/phase6-confirmation-acceptance-article.json
```

## Authentication expired

Symptoms include a Google login page, CAPTCHA, access denial, or missing Blogger editor controls.

1. Stop the operation. Do not retry a mutation command.
2. Set both mutation flags to `false` and create `data/STOP` if a browser process may still be active.
3. Close the automation Chrome process.
4. Use `open-login` with the dedicated profile and complete login manually.
5. Close Chrome and run a non-mutating preview or audit first.
6. Remove `data/STOP` only for a separately authorized operation.

Never copy a personal Chrome profile into the automation profile.

## Post or schedule command failed

1. Leave the execution attempt and resume evidence unchanged.
2. Set both mutation flags to `false` and create `data/STOP`.
3. Inspect the job artifacts, screenshot, logs, and Blogger post list before deciding whether anything was saved.
4. Run `audit-published-post` if the target time has passed; it is read-only.
5. Do not delete attempt markers and do not rerun `execute-schedule` with different evidence.
6. A resume is allowed only by the existing code boundary, for the same hashes, at most once, and only after explicit authorization.

## Duplicate title detected

The audit intentionally fails unless there is exactly one exact-title match.

1. Do not publish, schedule, rename, or delete either post automatically.
2. Record the matching URLs and inspect them manually in the dedicated test blog.
3. Keep mutation flags `false` until the duplicate is resolved by an explicitly authorized action.
4. Rerun the read-only audit after resolution.

## Image audit failed

1. Do not repair or upload an image automatically.
2. Check that the image URL is HTTPS and hosted by Blogger/Googleusercontent.
3. Check HTTP status, `Content-Type: image/*`, and actual response size.
4. Treat redirects, empty bodies, non-image responses, and images over 20 MB as failures.
5. Any Blogger-side repair requires separate explicit authorization.

## Timezone mismatch

Do not schedule while the public feed offset differs from `APP_TIMEZONE`. Correct the Blogger blog timezone manually, verify the public feed again, and prepare new local evidence. Existing hashes must not be reused after changing schedule data.

## Evidence retention

Keep the database, job artifact directory, execution package, audit attestation, attempt/resume markers, screenshots, and logs together. Do not edit sealed JSON evidence in place.
