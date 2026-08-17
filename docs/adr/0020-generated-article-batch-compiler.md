# ADR 0020: Generated article batch compiler

## Status

Accepted as the fourth Phase 6 capability.

## Context

The Phase 6 import and routing boundaries can already convert generated responses into an article queue and then into a multi-blog batch. Requiring operators to persist and pass an intermediate queue adds a manual step, while the existing batch contract discarded the generation request ID and source provenance before execution.

## Decision

- Add `compile-generated-batch --plan <path> --responses <path> --output <path>` as a database-free local command.
- Reuse the strict generated-response import boundary and the existing fail-closed blog-routing service without weakening either validation layer.
- Validate the complete import and every assignment before creating the output file.
- Preserve the generation request ID and attested HTTPS source URLs as optional provenance on each batch item.
- Keep hand-written and older batch manifests compatible by making provenance optional.
- Create, but never overwrite, the requested output file or either input file.
- Do not open a browser, contact Blogger, call an AI provider, or grant authority to execute the resulting batch.

## Consequences

Validated generated articles can enter the existing multi-blog batch workflow in one local command with their provenance intact. Batch execution behavior and all Blogger feature flags, STOP checks, blog allowlists, evidence gates, and explicit authorization requirements remain unchanged.
