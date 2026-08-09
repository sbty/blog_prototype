# ADR 0011: Campaign-wide preflight before job creation

## Decision

Add `validate-campaign` as a local, read-only validation command and make the same preflight the first stage of `prepare-campaign`.

The preflight parses the complete manifest and checks every blog selector file and required public URL, every schedule time, duplicate per-blog time slots, existing plus incoming system and per-blog daily limits, unique local image files, and non-mutating feature flags. Resumed jobs are not counted as new daily plans. Missing final-execution authorization is reported as a warning because preparation intentionally remains separate from Blogger mutation.

A failed preflight creates no campaign directory or schedule job and does not open a browser. A successful preparation stores `schedule-campaign-preflight.json` beside the campaign result, and the read-only campaign inspector validates that artifact when it is present. Per-item planning checks remain in place to protect against state changes after preflight.
