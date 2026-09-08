# Token-efficient work router

Read this file once. Then read only the local `SKILLS.md` for directories that
the task will change or operate. For a cross-cutting change, read each touched
area; never discover or load all instruction files recursively.

| Scope | Local guidance |
| --- | --- |
| Blogger UI automation | `src/browser/SKILLS.md` |
| Workflow orchestration | `src/services/SKILLS.md` |
| Pure models and validation | `src/domain/SKILLS.md` |
| Commands and arguments | `src/cli/SKILLS.md` |
| Configuration | `src/config/SKILLS.md` |
| Persistence | `src/repositories/SKILLS.md` |
| Tests | `src/tests/SKILLS.md` |
| Operational scripts/artifacts | `scripts/SKILLS.md`, `data/SKILLS.md` |
| Documentation/samples/themes | corresponding directory `SKILLS.md` |

## Common execution policy

- Complete an approved goal as one work unit. Give updates at material
  milestones, not after every small action. Continue through necessary work units
  within the saved completion criteria; ask only at the decision boundaries in
  `AGENTS.md`. Do not require a new `/goal` for routine implementation decisions.
- Reuse existing evidence. Before an external mutation take one targeted
  baseline; afterward use one independent re-read. Preserve successful work.
- On failure, diagnose once, make the smallest fix, run focused checks, and make
  at most one equivalent retry. Do not loop on the same external failure.
- Keep reports compact and prefer one aggregate JSON artifact. Never bulk-read
  `data`, all ADRs, or generated output to "get context".
- Keep draft and scheduled-post safety boundaries intact. A target/state/content
  mismatch or failed persistence check must stop the mutation.
- Run focused tests while editing and the required validation suite once at the
  end. Do not edit generated `dist` or dependencies in `node_modules`.
