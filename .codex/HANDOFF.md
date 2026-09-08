# Codex Handoff

Updated: 2026-09-08 JST
Status: compact process-driven audit boundary implemented locally; remote push requires approval
Branch: codex/agent-workflow-and-audit
Local history includes: 99c6075 fix: compact existing draft audit summaries

## Priority for the next session

Push commit `99c6075` only after the user explicitly approves exporting it to
the configured GitHub remote. Do not expand the Blogger audit while the current
selection report has no eligible targets.

## Root-cause fix completed locally

- Root `AGENTS.md` now sets response budgets: five for routine Markdown changes
  and six for normal read-only audits, with exceptions only for new failures,
  required input, or safety stops.
- Long-running processes must be owned and polled inside one orchestration call
  when supported; unchanged polls cannot be returned to the model for analysis.
- Multi-item audits require one deterministic command that iterates internally
  and emits one compact aggregate report.
- Markdown-only changes use `git diff --check` instead of the full application
  test suite.
- Automatic push stops before exporting detailed HANDOFF contents, local paths,
  usage logs, or internal operational state without explicit approval.
- HANDOFF updates are no longer mandatory for explanations, status checks, or
  trivial documentation changes.

## Measured failures

- Blogger read-only audit: 7.80M tokens, 68 model responses, and 62 tool calls
  in 18.4 minutes. The turn included 44 shell calls and 15 model-mediated
  `write_stdin` polls. Median input was 117,029 tokens per response.
- Automatic-push policy edit: 3.77M tokens and 29 model responses for a small
  Markdown/policy change. It used 20 tool calls; median input was 151,567
  tokens per response.
- The later two-hour token analysis itself used 2.00M tokens and moved the
  five-hour usage meter from 75% to 86%, because it was split into 32 model
  responses.
- In all cases, roughly 99% of input was cached. The dominant problem was
  repeatedly resending a large context across many model/tool round trips, not
  visible response size or file size.

## Audit-runner redesign completed locally

- `audit-existing-draft-batch` continues to iterate all targets internally in
  one process; no per-item model loop is needed.
- Each complete audit result is written once to its individual detail file.
- `summary.json` now contains only status, counts, compact item metadata,
  reasons, and `detailFile` references. It no longer duplicates complete reports
  or post editor URLs.
- Focused tests cover the compact report boundary. Repository validation passed:
  79 test files, 614 tests, lint, and typecheck.

## Acceptance criteria

- A representative read-only audit is orchestrated in no more than about five
  model responses, excluding a genuine user approval or error-recovery turn.
- A small policy/HANDOFF edit normally completes in no more than about six model
  responses, including validation and push.
- No per-item model loop and no periodic model-mediated polling remain in the
  normal audit path.
- The audit command emits a compact machine-readable summary sufficient for the
  final user report; raw logs stay out of model context.
- Run the smallest focused check first and run
  `powershell -ExecutionPolicy Bypass -File scripts/verify-agent.ps1` exactly
  once before completion unless it fails and a targeted retry is required.
- Compare response count and token usage against the measured failures above.

## Existing audit state and safety

- The latest selection report remains at
  `data/existing-draft-audit-selection-live-selection-v14/selection-report.json`.
- It selected 0 eligible targets, excluded 60, and left 4 `UNVERIFIED` because
  of editor-page navigation timeouts.
- Do not run `audit-existing-draft-batch` while there are no eligible targets.
- Keep `ENABLE_DRAFT_SAVE`, `ENABLE_SCHEDULED_POST`, and
  `ENABLE_EXISTING_DRAFT_UPDATE` disabled for all redesign validation.
- Do not save, schedule, publish, repair, or delete Blogger content without
  explicit user approval.
