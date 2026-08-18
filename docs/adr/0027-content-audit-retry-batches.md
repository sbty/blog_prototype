# ADR 0027: Content audit retry batches

## Status

Accepted as a Phase 7 capability.

## Context

The mandatory draft-save quality gate stops an entire batch when one or more articles fail. Rebuilding a retry batch by hand can accidentally include articles that already passed, omit a failed item, or combine an audit report with the wrong source manifest.

## Decision

Add `prepare-content-audit-retry --manifest <path> --audit <path> --output <path>`.

The command validates the durable audit schema and its aggregate counts, requires a failed audit and a `save-drafts` source batch, and compares every audit index, blog key, and slug against the source manifest. It writes a new batch containing only failed articles and the blog configurations those articles require. The original files are never overwritten.

The retry batch remains a normal `save-drafts` manifest. Operators edit or regenerate its failed articles, then invoke `run-batch`; the mandatory quality gate audits the complete retry again before Blogger execution.

## Consequences

- Passing articles are not saved twice during quality remediation.
- An audit from another batch or a tampered report is rejected.
- Duplicate issue codes are summarized for operator logs without changing article content.
- The command is local-only and does not open Blogger, use the database, or call an AI provider.
