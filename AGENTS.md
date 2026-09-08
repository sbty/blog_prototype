# Blogger multi-blog automation

Key areas: `src/browser` (Blogger UI), `src/services` (workflows),
`src/domain`, `src/repositories`, `src/tests`, `examples`;
`docs/adr` is historical only.

Rules:
- Continue autonomously within the user's completion criteria: inspect the current
  implementation, preserve existing changes, save a plan, and choose the next
  implementation/validation unit without waiting for routine confirmation.
- Active completion criteria, evidence, progress, and concrete next actions are
  tracked in [the draft completion plan](docs/draft-completion-plan.md). Verify
  implementation when older plans or handoffs disagree. Record scope-expanding
  improvements only; do not implement them as part of this goal.
- Ask with a recommendation and reason only for major scope changes, new costs,
  data deletion, production rollout, publication, or unresolved permission blocks.
  Continue independent work while a decision is pending.
- At interruption, save the plan, completed work, blockers, and exact next action
  so that "continue" resumes the task. Report material progress concisely.
- Never publish without explicit user approval.
- Keep draft and scheduled-post mutation boundaries separate; never weaken them for tests.
- Make minimal changes.
- Do not read every ADR; use only current task-specific references.
- For implementation or operational work, read root `SKILLS.md` as a router,
  then only the local `SKILLS.md` files for directories actually in scope.
- If continuing previous work, read `.codex/HANDOFF.md`.
- Do not treat HANDOFF.md as authoritative if it conflicts with the repository;
  Verify repository state efficiently:

- Start with `git status --short`.
- Use `git diff --stat` and `git diff --name-only` before inspecting diffs.
- Never run an unrestricted `git diff` when the worktree is broad.
- Inspect diffs only for files relevant to the current goal:
  `git diff -- <path>`.
- Do not inspect unrelated existing changes.

Context efficiency:
- Search with `rg` or `git grep` before opening files.
- Read only files and line ranges relevant to the current task.
- Do not recursively inspect `docs`, `examples`, or unrelated directories.
- Do not reread unchanged files unless necessary.
- Do not dump entire large logs or generated files; search or tail relevant sections.
- Keep terminal output concise.

Context budget:
- Treat all tool output as expensive model context.
- Keep individual tool output below roughly 10,000 characters whenever practical.
- If a command may produce large output, redirect it to a file and inspect only the relevant portion.
- Do not combine multiple large file reads into one command.

Execution round-trip budget:
- Treat every model/tool-result boundary as the primary token cost. Batch
  independent reads, checks, and safe commands into one tool invocation.
- A routine Markdown or instruction-only change should use at most five model
  responses: one baseline, one edit, one validation/commit operation, and one
  final report, with one spare response for a genuine failure.
- A normal read-only audit should use at most six model responses. Exceed these
  budgets only for new failure evidence, required user input, or a safety stop;
  never exceed them for repeated confidence checks.
- Do not use the model as a polling loop. When the tool interface supports it,
  one orchestration call must own the long-running process, wait or poll it
  internally, and return only meaningful progress or the final compact result.
- If control returns with a live process, use one bounded wait with the largest
  safe interval. Poll again only after meaningful progress or a changed state;
  unchanged polls must not be narrated or reanalyzed by the model.
- Before starting a multi-item audit, require one command that performs the
  iteration internally and emits one compact aggregate report. Stop if the
  workflow instead requires a model decision for each item.

Token usage measurement:
- Assign each meaningful work block exactly one primary category:
  discovery, implementation, validation, documentation, git_operations,
  blogger_read, or blogger_mutation.
- Derive usage from existing Codex logs; do not create extra model turns solely
  for measurement.
- Aggregate results when a work block finishes or when the user requests them.
- Do not paste or reread raw usage logs into the conversation.
- Tool-based categories may overlap and must not be summed as total usage.
- Measurement failure must not block the primary task.
- For task-local usage analysis, parse the existing JSONL logs in one local
  aggregation pass. Do not search product documentation unless the user asks
  about product semantics, billing, or limit behavior.

Search:
- Always narrow `rg` / `git grep` by path and pattern before increasing context.
- Avoid broad `rg -C` searches across large directories.
- Prefer filenames/counts first when a search may have many matches.
- Limit search output to roughly 30-50 relevant lines when practical.
- If there are many matches, refine the search instead of displaying all matches.

File reads:
- Never dump an entire large source file unless strictly necessary.
- Locate the relevant symbol or line first, then read the smallest useful range.
- Prefer approximately 50-120 lines per read for large files.
- Do not reread unchanged ranges already inspected during the current goal.

Git inspection:
- Start with:
  - `git status --short`
  - `git diff --stat`
  - `git diff --name-only`
- Do not run an unrestricted `git diff` when the worktree is broad.
- Inspect only goal-relevant diffs with `git diff -- <path>`.

Git commits and pushes:
- Before the first commit for a work unit, create or switch to a task-scoped
  `codex/` branch when the current branch is protected or requires pull requests.
- Automatically create a local commit when a coherent, reviewable work unit is
  complete and its relevant validation passes; do not wait for a separate commit
  instruction.
- After committing, automatically push the current branch to its configured
  upstream. If it has no upstream, use a normal `git push -u origin <branch>`.
- Before an automatic push, inspect the staged scope for credentials, local
  paths, usage logs, or internal operational state. A commit containing such
  material, including a detailed `.codex/HANDOFF.md`, stays local until the user
  explicitly approves exporting it to the configured remote.
- Prefer one commit per functional, documentation, or process unit. Avoid
  per-file, per-command, and broad catch-all commits.
- Stage only files or hunks in the current scope and preserve unrelated changes.
- Never force-push or bypass branch protection. If a push is rejected only
  because the branch requires pull requests, create or switch to a task-scoped
  `codex/` branch at the current HEAD and retry one normal push. Stop and report
  any other rejection or non-fast-forward result rather than rewriting history.
- PR creation is authorized for this scope. Review the diff and resolve findings
  before merging; merge only when mandatory checks pass, there are no conflicts,
  and the scoped change does not deploy to production. Do not tag without approval.

Validation:
- During implementation, run the smallest relevant test/check first.
- For code or operational-script changes, before completing or handing off run:
  - `powershell -ExecutionPolicy Bypass -File scripts/verify-agent.ps1`
- For changes limited to Markdown, `AGENTS.md`, or `.codex/HANDOFF.md`, run
  `git diff --check`; do not run application tests unless executable examples,
  generated artifacts, or code behavior changed.
- Do not run `npm test`, `npm run lint`, and `npm run typecheck`
  separately when `verify-agent.ps1` already covers them.
- Successful validation output must remain minimal.
- Full validation stdout/stderr belongs in `.agent/logs/`.
- On failure, inspect only the relevant error section first.
- Do not read an entire validation log unless targeted inspection is insufficient.

Handoff:
- Update `.codex/HANDOFF.md` only when another session needs non-obvious state:
  unfinished work, an operational blocker, a user-requested handoff, or a
  completed work unit whose next action is not evident from the repository.
- Do not update HANDOFF for a standalone explanation, status check, or trivial
  documentation edit unless the user explicitly asks.
- Keep HANDOFF.md concise and replace stale state instead of appending history.
