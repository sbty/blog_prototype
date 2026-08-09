# ADR 0013: Exact retry manifests for schedule batches

## Decision

After a schedule approval, evidence-preparation, or final-execution batch has started, write `schedule-batch-retry.json` whenever an item is `FAILED` or `SKIPPED`. The retry manifest preserves the original operation, `continueOnError` policy, item order, job confirmation, and package and audit hashes, while excluding every successful item.

The generated file is accepted directly by the existing `run-schedule-batch --manifest` command. Final-execution retries therefore remain subject to the all-items preflight, exclusive attempt marker, matching evidence hashes, and single bounded-resume marker. Generating a retry manifest does not itself authorize or perform a Blogger mutation.

A failure in the all-items execution preflight occurs before batch artifact creation and does not produce a retry file; the operator must correct the original manifest, job state, authorization, or environment first. Runtime failures retain their durable batch report and exact retry subset so already successful jobs are not submitted again.
