# ADR 0015: Read-only schedule-batch list

## Decision

Add `list-schedule-batches` as a database-independent, read-only overview of schedule-batch directories under the physical `DATA_DIR/jobs` boundary.

The list accepts only direct child directories with the `schedule-batch-` identifier shape, limits scanning to 1,000 batches, delegates each candidate to the strict schedule-batch inspector, and orders valid batches by completion time newest first. Valid entries retain their operation, counts, report path, execution path, retry path, and `COMPLETED`, `RETRY_AVAILABLE`, or `ATTENTION` state. A malformed batch is isolated as `INVALID` instead of failing the entire list.

The command ignores ordinary jobs and schedule campaigns. It performs no database, artifact, browser, or Blogger writes and remains usable while STOP is present.
