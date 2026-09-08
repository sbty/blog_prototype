# Operational scripts

- Scripts should compose existing CLI/services rather than duplicate business or
  safety logic. Keep inputs, target IDs, budgets, and output paths explicit.
- Validate all inputs before external work. Default to no-overwrite output and
  fail closed on contradictions or missing evidence.
- Keep scripts deterministic and reports compact. Do not scan all of `data` when
  a manifest can name the required files.
- Modify source scripts, not generated `dist`, and add focused tests when a script
  contains reusable decision logic.

## Thread handoff

- At interruption or when non-obvious resume state is needed, update `.codex/HANDOFF.md` once and keep the active plan current, following root `AGENTS.md`.
- Replace stale task state instead of appending history. In a new thread, treat HANDOFF as orientation only and verify it against `git status`, `git diff`, and relevant code.
