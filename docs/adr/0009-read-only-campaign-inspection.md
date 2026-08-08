# ADR 0009: Read-only campaign inspection

## Decision

Add `inspect-campaign --campaign <campaignId>` as a read-only operational view. It resolves the campaign only beneath `DATA_DIR/jobs`, strictly parses the stored result, verifies reported paths and counts, validates execution and retry manifests, compares package and audit bytes with their recorded SHA-256 values, and reads current job state.

Each article is classified as ready to execute, retryable, executed, evidence-invalid, job-missing, job-state-invalid, or needing attention. Executed classification requires a structurally valid exclusive execution-result artifact rather than relying on the unchanged `PREVIEW_CONFIRMED` database state. Missing manifests are invalid when the corresponding successful or retryable items exist.

Inspection performs no database, artifact, browser, or Blogger writes and remains available while STOP is present so operators can diagnose a halted campaign.
