# Blogger browser automation

- Read only the browser modules named by the failing flow. For live operations,
  consult `docs/multi-blog-operations-runbook.md`; do not load unrelated ADRs.

- Keep selectors and UI mechanics here; workflows belong in `src/services`.

- Treat list-page state and persistent “saved” text as hints, not proof. Prove a
  write with a fresh isolated browser context and field-by-field re-read.

- Mutations must verify blog ID, post ID, expected state, and allowed fields
  before interaction. Stop on selector ambiguity or unexpected navigation.

- Reuse the Chrome recovery/context helpers. Do not modify or delete the signed-in
  source profile, and never weaken dry-run or mutation guards for a test.

## Context and tool-output efficiency

- Never print full article HTML, page source, DOM snapshots, accessibility trees,
  or large JSON payloads into model context unless explicitly required to diagnose
  a problem that cannot be resolved from a smaller representation.

- Store large browser/audit artifacts under `data/` and return only:
  - artifact path
  - match / mismatch status
  - relevant field names
  - lengths or counts
  - hashes when useful
  - minimal diff snippets

- For expected/actual content comparisons, compare locally first. Do not return
  both full values. Report only the first relevant differences and their context.

- Limit normal diagnostic snippets to at most 500 characters per side and at most
  3 differences unless more evidence is required.

- Prefer field-level state such as:
  `title`, `body`, `status`, `scheduledAt`, `blogId`, `postId`
  over raw DOM or full-page representations.

- Search browser logs and artifacts with `rg`, targeted JSON queries, or small
  helper scripts before reading them. Do not dump entire logs or audit files.

- Do not emit the same expected/actual content more than once in a goal.

- Keep normal browser-tool stdout compact. If output would be large, write it to
  an artifact and return a concise summary instead.

## Diagnosis escalation

Use the smallest evidence level that can answer the question:

1. Match status, lengths, counts, hashes
2. Up to 3 small diff snippets
3. Relevant DOM/HTML section only
4. Full raw artifact only as a last resort

Do not jump directly to level 4.

## Browser verification

- For a successful mutation, verify only the fields relevant to the mutation plus
  required identity/state guards.
- Do not capture or return unrelated page content during verification.
- If verification establishes a blocker, stop rather than repeatedly rereading
  the same page state.