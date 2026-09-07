# Persistence adapters

- Repositories persist and retrieve data; workflow and browser decisions belong
  elsewhere. Keep mapping explicit and deterministic.
- Do not overwrite audit evidence or operational reports by default. Prefer a new
  output path and atomic completion where the format supports it.
- Preserve stable IDs and timestamps, and test round trips plus missing/corrupt
  input behavior for schema changes.
