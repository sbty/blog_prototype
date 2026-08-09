# ADR 0016: Two-blog scheduled acceptance

## Decision

Record one explicitly authorized acceptance run across two dedicated, non-production Blogger blogs. The run reused exactly one matching draft per blog and scheduled both articles for `2026-08-10 02:45 JST` through one prevalidated execution batch.

Both blog IDs were present only in the ignored local allowlist. Campaign validation covered both blogs and both articles before preparation. Each job then passed readiness, mutation-blocked browser preview, preview confirmation, sealed-package preparation, independent SHA-256 audit, execution preflight, and per-item revalidation. The execution batch completed with two successes, zero failures, and zero skips. Both posts were subsequently observed as public by the operator.

The second blog initially had no published feed entry. Scheduled execution remained fail-closed until its post search-description setting was enabled and its Blogger timezone was changed to Tokyo. Empty-blog timezone validation now uses the Blogger feed-level `updated` timestamp only when no entry exists; feeds with an entry continue to require that entry's valid `published` timestamp. In both cases, the observed UTC offset must match `APP_TIMEZONE` before an attempt marker or browser mutation.

## Scope

This ADR supersedes only ADR 0006's statement that live acceptance covered a single blog. It does not weaken the allowlist, exact confirmation, evidence hashes, STOP checks, mutually exclusive flags, future-time check, execution markers, or evidence-identical bounded resume.

The acceptance does not authorize another save, schedule, publish, repair, rename, or deletion; a third blog; production credentials; unattended publication; generalized rollout; unbounded retries; or removal of exclusive execution markers. Any further Blogger mutation still requires explicit user authorization.
