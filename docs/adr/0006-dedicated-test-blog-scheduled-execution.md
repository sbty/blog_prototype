# ADR 0006: Dedicated test blog scheduled execution

## Decision

Supersede ADR 0005's unconditional execution denial for one explicitly authorized acceptance scope. `execute-schedule` may mutate only the locally configured dedicated Blogger test blog and only when the exact job confirmation, sealed package SHA-256, independent audit SHA-256, feature flags, STOP state, and future schedule time all pass validation.

Execution writes an exclusive attempt marker before browser mutation and permits at most one matching interrupted-attempt resume. The configured image is uploaded before publish confirmation. Draft saving and scheduled execution remain mutually exclusive.

Before creating the attempt marker, execution reads the configured Blogger public feed and compares the UTC offset in its published timestamp with the offset expected from `APP_TIMEZONE` at that instant. Missing, malformed, unavailable, oversized, or mismatched feed evidence fails closed before browser mutation. This prevents a Blogger blog configured for Pacific time from silently interpreting a Japan-local schedule incorrectly.

## Acceptance record

One post was manually confirmed after the automated final-confirmation selector failed. Read-only audits observed exactly one scheduled post and later exactly one published post. The configured image was then added automatically to that same post, with `insertedImageCount=1`; the public feed returned one image whose URL responded HTTP 200.

A second explicitly authorized acceptance post (`6505847780460755748`) then completed the entire automated path: image upload, settings, `2026-08-06 09:00 JST` schedule selection, Publish, the measured out-of-dialog `確定` control, result evidence, and a read-only `スケジュール済み • 木 9:00` audit with exactly one matching post.

These acceptances do not authorize another post, another blog, production rollout, retries beyond the bounded resume, or generalized publication.
