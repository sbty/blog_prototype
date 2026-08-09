# ADR 0012: All-items preflight before scheduled batch execution

## Decision

Before `run-schedule-batch` executes an `execute-schedules` manifest, validate every item without creating a batch artifact or opening the Blogger editor. Any failure rejects the complete batch before its first Blogger mutation, regardless of `continueOnError`.

Each preflight verifies the execution flags and STOP state, exact job confirmation, `PREVIEW_CONFIRMED` state, registered and authorized blog, physical artifact containment under `DATA_DIR/jobs`, package and audit hashes and schemas, evidence-chain identity, article schedule identity, remaining lead time, completion and bounded-resume markers, public URL, and the Blogger feed timezone. Validation failures are aggregated with their job IDs so multiple configuration problems can be corrected together.

After the all-items gate succeeds, each item repeats the same validation immediately before its exclusive attempt marker and Blogger interaction. This preserves the existing partial-runtime-failure behavior while reducing avoidable partial batches caused by invalid later items. The preflight itself grants no Blogger authority and performs no Blogger mutation.
