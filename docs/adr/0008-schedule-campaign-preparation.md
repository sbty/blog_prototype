# ADR 0008: Schedule campaign preparation

## Decision

Add `prepare-campaign` as the primary non-publishing workflow for multiple articles across multiple Blogger blogs. One strictly validated manifest supplies every blog and scheduled article. Each item sequentially invokes the existing schedule-plan, local-approval, browser-preview, preview-confirmation, execution-package, and independent-audit services.

The command itself is explicit local approval for every listed item. Generated job IDs are used as the existing exact confirmations, and generated artifacts are re-read for hash chaining. This removes manual ID and SHA transcription without bypassing semantic, quota, timestamp, screenshot, network-guard, STOP, or exclusive-artifact checks.

The command requires `ENABLE_DRY_RUN=true`, `ENABLE_DRAFT_SAVE=false`, and `ENABLE_SCHEDULED_POST=false`. It cannot save or schedule a Blogger post. Successful items are emitted into a ready-to-use `schedule-execution-batch.json`; final Blogger mutation remains a separate, explicitly enabled command with the configured blog allowlist.

Failures record whether planning, approval, or evidence preparation failed. Ordinary failures continue by default. Fail-fast and STOP skip all remaining items. Partially planned or approved jobs remain recorded for audit and deliberate recovery rather than being silently deleted or rolled back. A generated `schedule-campaign-retry.json` retries failed and skipped items. Items with an existing job carry `resumeJobId`; recovery requires exact blog configuration and article equality, resumes only `READY_FOR_POST`, `APPROVED_FOR_POST`, or `PREVIEW_CONFIRMED`, and verifies reusable preview, package, and audit artifacts.
