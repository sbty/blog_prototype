# Codex Handoff

Updated: 2026-09-08 JST
Status: execution guardrails fixed locally; audit runner redesign remains
Branch: codex/agent-workflow-and-audit
Local history includes: d00f570 docs: hand off token efficiency redesign

## Priority for the next session

Implement the process-driven read-only audit runner before expanding the
Blogger audit. Root execution rules now prevent the model-driven polling and
over-validation patterns that caused the excessive token usage.

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

## Remaining audit-runner redesign

1. Make read-only audit execution deterministic and process-driven. Start one
   explicit command, let the process iterate internally, and return one compact
   aggregate JSON report. Do not make the model control each candidate or poll
   repeatedly.
2. Separate audit execution from report interpretation and Git operations.
3. Use lower reasoning effort for routine audit inspection when task/session
   controls permit it.
4. Add focused tests for the deterministic runner and compact report boundary.

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
