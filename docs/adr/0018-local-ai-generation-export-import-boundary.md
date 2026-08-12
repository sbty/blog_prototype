# ADR 0018: Local AI generation export/import boundary

## Status

Accepted as the second Phase 6 capability.

## Context

Article queue routing accepts complete articles, but the repository has no controlled boundary for preparing model instructions or accepting generated content. Direct provider integration would introduce credentials, usage cost, network behavior, model drift, and provider-specific retention settings before the input and output contracts are stable.

## Decision

- Add a local generation plan containing full blog configurations, explicit briefs, required points, routing topics, and HTTPS source URLs.
- Export a sanitized generation package that excludes Blogger admin URLs, public URLs, editor URLs, selectors, and credentials.
- Do not call an AI provider. The package is provider-neutral structured JSON.
- Require generated responses to pass the existing strict `ArticleInput` schema.
- Require exactly one response per planned request, unchanged slug and schedule, and an exact source-URL attestation.
- Convert successful responses into the Phase 6 article-queue format with the planned explicit blog assignment, generation request ID, and source provenance.
- Create output files without overwriting existing files.

## Consequences

The system can now prepare provider-neutral generation work and safely import results, while API keys and paid requests remain outside the repository. Source attestation records which planned sources the generator claims to have used; it is not a factuality guarantee or human editorial approval. A future online adapter requires an explicit provider choice, credential boundary, cost limits, retention policy, retry policy, and separate ADR.
