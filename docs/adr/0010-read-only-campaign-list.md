# ADR 0010: Read-only campaign list

## Decision

Add `list-campaigns` as a read-only overview of campaign directories under the physical `DATA_DIR/jobs` boundary. It ignores ordinary job directories, delegates every candidate to the strict campaign inspector, orders valid campaigns by completion time, and isolates malformed campaigns as `INVALID` instead of failing the entire list.

Campaigns are summarized as ready to execute, retryable, completed, needing attention, empty, or invalid. Any evidence, job-state, or manifest problem takes precedence as `ATTENTION`. Scanning is bounded to 1,000 campaign directories to prevent unexpectedly expensive diagnostics.

The command performs no database, artifact, browser, or Blogger writes.
