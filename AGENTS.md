# Blogger multi-blog automation

Key areas: `src/browser` (Blogger UI), `src/services` (workflows),
`src/domain`, `src/repositories`, `src/tests`, `examples`;
`docs/adr` is historical only.

Rules:
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
- Automatically create a local commit when a coherent, reviewable work unit is
  complete and its relevant validation passes; do not wait for a separate commit
  instruction.
- After committing, automatically push the current branch to its configured
  upstream. If it has no upstream, use a normal `git push -u origin <branch>`.
- Prefer one commit per functional, documentation, or process unit. Avoid
  per-file, per-command, and broad catch-all commits.
- Stage only files or hunks in the current scope and preserve unrelated changes.
- Never force-push or bypass branch protection. Stop and report a rejected or
  non-fast-forward push rather than rewriting remote history.
- Do not merge, tag, or open a pull request without explicit user instruction.

Validation:
- During implementation, run the smallest relevant test/check first.
- Before completing or handing off a goal, run:
  - `powershell -ExecutionPolicy Bypass -File scripts/verify-agent.ps1`
- Do not run `npm test`, `npm run lint`, and `npm run typecheck`
  separately when `verify-agent.ps1` already covers them.
- Successful validation output must remain minimal.
- Full validation stdout/stderr belongs in `.agent/logs/`.
- On failure, inspect only the relevant error section first.
- Do not read an entire validation log unless targeted inspection is insufficient.

Handoff:
- When pausing or completing a goal, update `.codex/HANDOFF.md`.
- Keep HANDOFF.md concise and replace stale state instead of appending history.
