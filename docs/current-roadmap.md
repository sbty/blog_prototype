# Current roadmap and worktree inventory

Updated: 2026-09-08 JST

The active user-approved goal is now [draft completion](draft-completion-plan.md).
The inventory below is historical and must be checked against the repository;
it does not prevent autonomous work within that goal. Phase checklists
record completed release scope, while `.codex/HANDOFF.md` records only the most
recent bounded work unit. Follow the active plan for the next in-scope work unit.

## Verified baseline

- `main` is at `d735f61` (`fix: tighten remediation output length (#76)`).
- The committed baseline contains the Phase 2-6 local workflows and the Phase 7
  content-audit/remediation boundary described in `README.md` and `CHANGELOG.md`.
- The classification baseline had 39 modified tracked files and 83 untracked
  files. After recording the classification and ignoring 16 preserved
  generated/local-evidence files, Git status exposes 68 untracked files. The
  largest tracked concentrations are
  `src/browser/bloggerDryRun.ts` (`+1490/-37`) and
  `src/cli/operationalCli.ts` (`+751/-7`).
- The corrected `scripts/verify-agent.ps1` passes its full real run: 78 Vitest
  files, 597 tests, lint, and TypeScript. Its focused self-test also proves the
  success path, separate failures from tests/lint/typecheck, and a missing npm
  executable. The token-report suite independently passes 4 tests.

No inventory result or passing test authorizes a Blogger save, schedule,
publish, repair, or deletion.

## Functional inventory

| Workstream                                            | Main evidence in the worktree                                                                                                        | Current assessment                                                                                                                   | Roadmap treatment                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Phase 7 content audit and remediation                 | Content audit/compiler, remediation import/package/provider changes and tests                                                        | Product-aligned and locally tested; documentation calls Phase 7 implemented, but the older local-completion handoff stops at Phase 6 | Close as a release-baseline/documentation unit before starting a new phase               |
| Generation provenance and cost evidence               | Queue provenance, source attachment/compiler changes, OpenAI usage fields, isolated generation scripts                               | Useful Phase 6/7 hardening; general service changes are mixed with operation-specific scripts                                        | Review service/schema changes as one unit; keep paid-generation scripts separate         |
| Draft authorization and persisted-save proof          | Draft blog-ID allowlist, existing-draft flag, persistence model, draft-save service, network transaction and fresh-context checks    | High-value safety work with broad browser impact; locally tested but mutation-capable                                                | Review before any live use; require a separate approval-bound acceptance goal            |
| Existing-draft selection and complete audit           | New selection/batch domain models, four services, read-only CLI routes, examples and tests                                           | Cohesive read-only feature and the safest next product increment                                                                     | Proposed Phase 8 core                                                                    |
| Scheduled permalink audit and repair preparation      | Read-only audit/re-audit/preparation services plus CLI and tests                                                                     | Read-only portion is cohesive; actual repair mechanics are mixed into browser code and one-time canaries                             | Put audit/preparation in Phase 8; defer repair execution to Phase 9                      |
| Complete published-post audit and publication monitor | Complete audit service, monitor domain/service/CLI and tests                                                                         | Cohesive read-only feature; intentionally not a daemon or unattended retry loop                                                      | Proposed Phase 8 core                                                                    |
| Blogger UI recovery and editor hardening              | Chrome recovery context, selector updates, image recovery, settings guards, post-state detection, large `bloggerDryRun.ts` expansion | Supports several workstreams but is the main review and regression-risk concentration                                                | Split by observable capability before acceptance; avoid a broad incidental refactor      |
| Target-specific operational canaries                  | Three permalink-only canary scripts and tests with fixed target IDs/hashes                                                           | Historical, approval-bound operational evidence; not a reusable product command                                                      | Keep out of the general feature unit; archive or retain locally after evidence review    |
| Batch/content operation helpers                       | Draft/content audit helpers, canonical builder, item selector, isolated-plan combiner                                                | Mixed: some reusable composition, some one-off data preparation, and some overlap with newer CLI services                            | Decide script-by-script; remove duplication before treating them as supported interfaces |
| Token/context-growth reporting                        | Python report generator, four tests, four generated reports                                                                          | Complete bounded diagnostics, but unrelated to Blogger product delivery                                                              | Park as optional developer tooling; do not use it as the next product direction          |
| Agent/process scaffolding                             | Root and directory `SKILLS.md`, `AGENTS.md`, validation script and log ignores                                                       | Validation false-positive fixed and regression-tested; remaining files still need classification                                     | Worktree stabilization gate, separate from product features                              |
| Generated or redundant artifacts                      | `reports/`, Python bytecode, `blogger-source.zip`, local `.codex` helpers                                                            | Not product source and likely unsuitable for the product change set                                                                  | Classify and ignore/archive explicitly; do not silently delete during inventory          |

## Main gaps and risks

1. The worktree is not reviewable as a single change. Read-only workflows,
   mutation mechanics, operational experiments, generated reports, and agent
   configuration need separate change units.
2. Read-only and mutation responsibilities remain logically guarded, but their
   implementations meet in very large browser and CLI files. Those two files
   deserve the most focused review.
3. Three canary scripts contain fixed real-looking Blogger identifiers and
   evidence hashes. They must not become sanitized examples or reusable commands.
4. Planning documentation is inconsistent: `README.md` and `CHANGELOG.md`
   describe Phase 7, while `docs/local-completion-handoff.md` previously ended
   at Phase 6 and there is no Phase 7 completion checklist.
5. Generated reports, bytecode, and a source ZIP make status noisy and increase
   the chance of committing local evidence accidentally.

## Roadmap

### R0 — Stabilize and partition the current worktree

This is the active workstream. Do not add another product feature during R0.

Completion criteria:

- [x] Make `verify-agent.ps1` fail whenever tests, lint, or typecheck fail or
      cannot start.
- [x] Prove the wrapper's success and failure paths with
      `scripts/test-verify-agent.ps1`, then pass the real full validation run.
- [x] Classify generated reports, bytecode, the source ZIP, local canaries, and
      local helper scripts. Preserve the files, ignore only generated/local evidence,
      and record all 83 decisions in `docs/worktree-artifact-classification.md`.
- [x] Replace operational Blogger identifiers in five retained tests/fixtures
      with fake values while preserving identity relationships and focused coverage.
- [ ] Produce reviewable change units in this order:
  - [x] Process tooling: 21 files, reviewed as the closed set defined below.
  - [x] Phase 7/content pipeline: 27 paths, reviewed as the closed set defined below.
  - [ ] Read-only operations.
  - [ ] Mutation/browser hardening.
  - [ ] Target-specific operational evidence.
- [x] Reconcile Phase 7 documentation and add a reproducible completion checklist.
- [ ] Preserve all existing user work while partitioning; do not discard or rewrite
      unrelated changes.

#### R0 process-tooling review set

The process-tooling unit is fixed at 21 files:

- `.gitignore` and `package.json`; the latter supplies the `typecheck` command
  required by the validation wrapper.
- `AGENTS.md` and all 13 `SKILLS.md` files found at the root and under `data`,
  `docs`, `examples`, `scripts`, `src`, and `themes`.
- `scripts/verify-agent.ps1` and `scripts/test-verify-agent.ps1`.
- `docs/current-roadmap.md`, `docs/worktree-artifact-classification.md`, and
  `.codex/HANDOFF.md`.

Review result:

- The root router covers every local `SKILLS.md`; directory rules refine rather
  than contradict the root mutation, validation, context, and handoff rules.
- No process-set file is ignored, and no Blogger edit URL, long numeric
  Blogger-style identifier, API key pattern, or private-key marker was found.
- Exact local/generated ignore rules affect only the 16 classified files and do
  not hide this review set.
- `docs/local-completion-handoff.md` is deliberately excluded because its Phase 7
  completion change belongs to the next release-baseline unit.
- This review fixes the change boundary only; it does not stage or commit files.

#### R0 Phase 7 content-pipeline review set

The Phase 7 unit is fixed at 27 paths: 21 whole-file changes and selected hunks
from 6 mixed files.

Whole-file changes:

- `CHANGELOG.md`, `docs/phase7-completion-checklist.md`, and
  `scripts/generate-isolated-articles-with-total-budget.mjs`.
- `src/domain/articleQueue.ts`.
- Eight services: batch source attachment, content audit and compilation,
  remediation package and import, generated-article import, and the two guarded
  OpenAI adapters.
- Nine tests/fixtures: generation boundary, source attachment, content audit and
  compiler, remediation package and import, OpenAI generation, isolated budget,
  and the compact 16-slug boilerplate regression fixture.

Selected Phase 7 hunks only:

- `README.md`: source-aware integrated compilation and the Phase 7 checklist link.
- `package.json`: Phase 7 format/verification commands and the local-complete
  delegation; its `typecheck` hunk remains in process tooling.
- `src/cli/args.ts`, `src/cli/operationalCli.ts`, and
  `src/tests/cliArgs.test.ts`: only the required `--sources` compile input,
  routing, result summary, help text, and argument coverage.
- `docs/local-completion-handoff.md`: Phase 7 completion summary and checklist;
  its current-roadmap link remains in process tooling.

Review result:

- `contentBrief` now has direct tests across generated import, remediation export,
  tamper rejection, corrected import, and content audit anchoring.
- The integrated compiler's fourth source input is closed across parser, CLI,
  service, test, and README usage.
- Provider usage evidence is consumed by the isolated total-budget runner; no
  provider call was made during review.
- All 27 paths exist, none is ignored, and no known operational Blogger ID,
  editor URL, API key, or private-key marker was found.
- The operational regression fixture contains only 16 slugs and compact generic
  text markers; it contains no Blogger identity, URL, credential, or article body.
- This review fixes a hunk-level change boundary; it does not stage or commit files.

#### R0 Phase 8 existing-draft read-only review set

The first Phase 8 unit is fixed at 27 paths: 16 whole-file changes and selected
hunks from 11 mixed or shared files.

Whole-file changes:

- Three schemas under `src/domain`: existing-draft selection preparation,
  selection, and complete-audit batch manifests.
- Four workflows under `src/services`: selection preparation, bounded read-only
  selection, single complete audit, and sequential batch aggregation.
- Six focused tests: read-only browser inspection, CLI output boundaries, and
  the four service units above.
- Three sanitized examples for preparation, selection, and batch audit.

Selected Phase 8 existing-draft hunks only:

- `src/browser/bloggerEditorIdentity.ts` and
  `src/tests/bloggerEditorIdentity.test.ts`: strict Blogger post-ID extraction
  and post-list edit-URL normalization.
- `src/browser/bloggerDryRun.ts`: the post-list and existing-editor read models
  plus `findDrafts`, `listPosts`, and `inspectExistingDraft`; mutation, repair,
  scheduling, and persistence hunks remain outside this unit.
- `src/cli/args.ts`, `src/cli/operationalCli.ts`, and
  `src/tests/cliArgs.test.ts`: only the four preparation, selection, single-audit,
  and batch-audit commands and their routing/help coverage.
- `package.json`: the focused Phase 8 existing-draft format, test, and verification
  commands.
- `README.md`, `docs/current-architecture.md`, `docs/current-invariants.md`, and
  `docs/multi-blog-operations-runbook.md`: only the existing-draft and shared
  read-only evidence boundaries. Other Phase 8 and mutation guidance remains
  assigned to its owning unit.

Review result:

- All target identity checks now finish before a single-item audit creates a
  Blogger client. A mismatched blog ID, post ID, or editor URL cannot start an
  external read.
- A missing session or other read failure is preserved as `UNVERIFIED`, both per
  item and in batch counts; it is no longer converted to a content `FAIL` or lost
  without a report.
- Title-list reads verify the session before an empty result can be treated as
  duplicate-title evidence.
- Selection retries are bounded, complete batch reads are sequential, and a
  verified item is preserved when another item is `UNVERIFIED`.
- CLI reports use exclusive-create output paths. Selection can emit a local audit
  manifest, but no preparation, selection, or audit command invokes save,
  schedule, publish, repair, or delete behavior.
- Mismatch reasons remain compact; full field evidence stays in the JSON report
  instead of the normal CLI log summary.
- `npm run verify:phase8-existing-drafts` passes formatting, lint, build, and 8
  focused files / 92 tests without contacting Blogger.
- This review fixes a hunk-level change boundary; it does not stage or commit files.

#### R0 Phase 8 scheduled-permalink read-only review set

The second Phase 8 unit is fixed at 21 paths: 5 whole-file changes and selected
hunks from 16 mixed or shared files.

Whole-file changes:

- `src/services/scheduledPermalinkAuditService.ts` and
  `src/services/scheduledPermalinkRepairPreparationService.ts`.
- Their two focused service tests and the scheduled-permalink CLI boundary test.

Selected scheduled-permalink hunks only:

- `config/blogger-selectors.json`, `src/browser/bloggerSelectors.ts`,
  `src/browser/bloggerEditorIdentity.ts`, and `src/browser/bloggerDryRun.ts`: only
  the identity, permalink, scheduled-date/time, and read-only inspection support.
  Save, recovery, repair execution, and publication hunks remain outside this unit.
- `src/cli/args.ts`, `src/cli/operationalCli.ts`, and
  `src/tests/cliArgs.test.ts`: only initial audit, `UNVERIFIED` re-audit, and
  approval-only repair-preparation routing and output handling.
- `src/tests/bloggerEditorIdentity.test.ts`,
  `src/tests/bloggerPermalinkControls.test.ts`, and
  `src/tests/bloggerReadOnlyDraftInspection.test.ts`: only shared identity,
  permalink-selector, and scheduled-field read evidence.
- `package.json`: the focused scheduled-permalink format, test, and verification
  commands.
- `README.md`, `docs/current-architecture.md`, `docs/current-invariants.md`,
  `docs/multi-blog-operation-checklist.md`, and
  `docs/multi-blog-operations-runbook.md`: only scheduled-permalink and shared
  read-only evidence boundaries.

Review result:

- Initial audit validates the configured blog ID, exact editor URL post ID,
  retry bound, and positive concurrency before any browser inspection.
- Re-audit accepts only a post present as `UNVERIFIED` in the prior report and
  preserves its batch, blog, slug, post ID, editor URL, and scheduled time.
- Only an empty permalink with every other required audit check at PASS becomes
  `PERMALINK_ONLY`; a different non-empty slug remains
  `CANONICAL_DIFFERENCE`.
- Repair preparation rejects missing, duplicated, reclassified, or altered audit
  candidates and duplicate canonical identities before creating output.
- All three CLI paths finish target/package preflight before creating a new
  output directory and use exclusive-create report writes.
- Mismatch reasons remain compact; full comparison evidence stays in JSON.
- `npm run verify:phase8-scheduled-permalinks` passes formatting, lint, build,
  and 7 focused files / 84 tests without contacting Blogger.
- This review fixes a hunk-level change boundary; it does not stage or commit files.

### R1 — Close the Phase 7 release baseline

- Finish the content-audit/remediation and provenance refinements already in the
  worktree.
- Verify schemas, examples, CLI routing, no-overwrite behavior, and provider cost
  evidence without invoking Blogger or a paid provider.
- Exit with Phase 7 documentation and validation aligned.

### R2 — Proposed Phase 8: read-only multi-blog operations

- Deliver existing-draft selection and complete batch audit.
- Deliver scheduled-permalink audit, bounded re-audit, and approval-only repair
  preparation.
- Deliver complete published-post audit and due-publication monitoring.
- Keep all outputs no-overwrite and all uncertain reads `UNVERIFIED`; provide no
  path from a PASS report to an automatic mutation.

### R3 — Proposed Phase 9: explicitly authorized draft maintenance

- Review and isolate draft-save allowlisting, fresh-context persistence proof,
  image-only updates, and permalink-only updates.
- Define each permitted mutation independently. A permalink repair must not
  imply image, content, schedule, or publication authority.
- Run live acceptance only under a new target-specific goal and explicit user
  approval. One-time canaries do not establish general authorization.

### R4 — Proposed Phase 10: routine operations and automation

- Consider repeatable eight-blog operation only after Phase 8 read-only evidence
  and Phase 9 acceptance are stable.
- Unattended monitoring, automatic retry, automatic repair, and production
  publishing remain deferred decisions rather than implied follow-on work.

## Focus rule

Only one roadmap workstream may be active. Logs, reporting, refactoring, and test
infrastructure may be extended only when they are part of that workstream's
completion criteria. When a workstream is complete, select the next item from
this roadmap instead of continuing in the same technical direction by default.
