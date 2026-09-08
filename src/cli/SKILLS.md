# CLI boundary

- CLI code parses arguments, selects a workflow, prints concise results, and
  returns meaningful exit status. Business rules belong in services/domain.
- Keep read-only, draft mutation, scheduling, publication, and deletion commands
  visibly separate. Preserve their environment/approval guards.
- Validate target paths and IDs before invoking a workflow. Never silently choose
  a live target or overwrite an existing report.
- Add argument/routing tests for new flags; place behavior tests at the owning
  service or domain layer.
