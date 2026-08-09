# ADR 0014: Read-only schedule-batch inspection

## Decision

Add `inspect-schedule-batch --batch <batchId>` as a database-independent, read-only inspection command for schedule approval, evidence-preparation, and final-execution batches.

The inspector resolves the batch only under the physical `DATA_DIR/jobs` boundary and strictly validates the durable result schema, batch identity, artifact and reported paths, contiguous item indexes, status counts, operation-specific evidence, generated execution manifest, and generated retry manifest. Companion-manifest problems are reported as `ATTENTION`; a valid partial batch is `RETRY_AVAILABLE`, and a valid all-success batch is `COMPLETED`.

Execution manifests must exactly match successful preparation jobs and their package and audit hashes. Retry manifests must retain the original operation and exactly match failed and skipped job IDs in result order. The command performs no database, artifact, browser, or Blogger writes and remains usable while STOP is present.
