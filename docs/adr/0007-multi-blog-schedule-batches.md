# ADR 0007: Multi-blog schedule batches

## Decision

Scheduled jobs may be approved, prepared for execution, or executed in a sequential batch through `run-schedule-batch`. The complete manifest is validated before the first item runs. Each item still passes through the existing single-job service, so job state, exact confirmation, evidence hashes, STOP checks, future-time validation, browser mutation guards, and exclusive attempt markers remain mandatory.

Execution is fail-closed. `AUTHORIZED_BLOG_IDS` is a comma-separated allowlist of numeric Blogger blog IDs stored only in the untracked local environment. The legacy `AUTHORIZED_TEST_BLOG_ID` is also accepted during migration. An empty allowlist or a job targeting any other blog is rejected before browser mutation.

Approval and preparation batches require `ENABLE_DRAFT_SAVE=false` and `ENABLE_SCHEDULED_POST=false`; preparation also requires `ENABLE_DRY_RUN=true`. Preparation chains browser preview, preview confirmation, execution-package creation, and independent package audit, re-reading each generated artifact to pass its SHA-256 to the next existing service. Successful preparation items are written to a ready-to-use `schedule-execution-batch.json`, avoiding manual hash transcription. Execution batches require `ENABLE_DRAFT_SAVE=false` and `ENABLE_SCHEDULED_POST=true`. Ordinary item failures continue by default and are recorded; `continueOnError=false` and STOP skip every remaining item. A durable result is written under `data/jobs/<batchId>/schedule-batch-result.json`.

## Non-authorization

This implementation and its mock tests do not authorize or perform Blogger mutations. Operators must separately authorize the intended blogs and executions, populate real job IDs and per-job evidence hashes locally, and deliberately enable scheduled posting.
