# Codex Handoff

Updated: 2026-09-08 JST
Status: follow-up required — reduce excessive agent token usage
Branch: codex/agent-workflow-and-audit
Base commit: dd697ed fix: route automatic pushes through task branches

## Priority for the next session

Fix the agent orchestration that made read-only auditing and small policy-file
edits consume millions of tokens. Treat this as the next work unit before
expanding the Blogger audit.

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

## Required redesign

1. Make read-only audit execution deterministic and process-driven. Start one
   explicit command, let the process iterate internally, and return one compact
   aggregate JSON report. Do not make the model control each candidate or poll
   repeatedly.
2. Separate audit execution from report interpretation, HANDOFF updates,
   validation, and Git operations. Assign each work block one primary category.
3. Batch independent reads and Git checks. For a small Markdown change, target
   one baseline read, one patch, one required validation run, one commit/push
   operation, and one final report.
4. Use at most one bounded wait for a normal long-running command. Additional
   polling requires concrete evidence that the process made meaningful progress
   or needs input.
5. Use lower reasoning effort for routine inspection, Markdown edits, and Git
   bookkeeping when the task/session controls permit it.
6. Measure from existing JSONL usage records with one local aggregation pass.
   Do not create extra model turns, Web searches, or repeated log reads solely
   to measure usage.

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
