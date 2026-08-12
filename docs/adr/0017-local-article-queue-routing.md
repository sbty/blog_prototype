# ADR 0017: Local article queue routing

## Status

Accepted as the first Phase 6 capability.

## Context

The repository can execute reviewed multi-blog batches, but callers must already assign every article to a `blogKey`. Phase 6 needs a safe intake boundary that can validate a queue of completed article candidates and route them to the configured blogs before any browser or Blogger operation.

## Decision

- Add `prepare-article-queue --manifest <path> --output <path>` as a database-free local command.
- Accept complete `ArticleInput` values plus either an explicit `blogKey` or routing topics.
- Match routing topics only against each blog's `primaryTheme` and `topicClusters` after Unicode and case normalization.
- Reject blogs whose `excludedTopics` conflict with a queue item's routing topics.
- Reject zero-score automatic matches and equal-score ties instead of guessing.
- Validate the entire generated artifact with the existing `BatchManifest` schema before writing it.
- Create, but never overwrite, the requested output file.
- Do not open a browser, call an AI provider, or contact Blogger.

## Consequences

The output is compatible with the existing `run-batch` command, but compiling a queue does not authorize running that batch. Existing feature flags and safety boundaries still apply. Article text generation and external model-provider integration remain separate future decisions because they introduce credentials, cost, source attribution, and factual-quality requirements.
