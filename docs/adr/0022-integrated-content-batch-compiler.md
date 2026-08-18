# ADR 0022: Integrated content batch compiler

## Status

Accepted as the sixth Phase 6 capability.

## Context

The generated-article compiler and batch-image attachment boundary can produce a complete multi-blog batch, but operators must persist an intermediate text-only batch and invoke two commands. The target workflow needs a shorter path from reviewed generation outputs and corresponding local images to one execution-compatible batch.

## Decision

- Add `compile-content-batch --plan <path> --responses <path> --images <path> --output <path>` as a database-free local command.
- Reuse the strict generated-response import, blog routing, batch validation, and image attachment services without weakening their checks.
- Validate generated content before processing image assignments, then validate exact image coverage and files before creating output.
- Preserve generation request IDs, attested source URLs, blog assignments, article data, and validated physical image paths in the resulting batch.
- Create, but never overwrite, the requested output or any input file.
- Do not generate text or images, call an AI provider, open a browser, contact Blogger, access the database, or authorize execution.

## Consequences

Reviewed AI responses and local images can become a complete multi-blog, multi-article batch in one command. Running that batch remains a separate operation governed by its existing dry-run, draft-save, schedule-planning, STOP, and Blogger authorization boundaries.
