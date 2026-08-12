# ADR 0019: Guarded OpenAI Responses adapter

## Status

Accepted as the third Phase 6 capability.

## Context

ADR 0018 created a provider-neutral generation package and strict import boundary without making paid requests. The next capability needs an online provider adapter while preventing accidental spend, silent model changes, duplicate paid retries, secret leakage, and invalid response formats.

## Decision

- Use the OpenAI Responses API with Structured Outputs and `store: false`.
- Allow only `gpt-5.6-luna` initially because the official model guidance identifies it for cost-sensitive, high-volume workloads.
- Keep `ENABLE_ARTICLE_GENERATION=false` by default and require a non-empty `OPENAI_API_KEY` at execution time.
- Provide a free local estimate command before execution.
- Bound request count, UTF-8 input bytes, maximum output tokens, timeout, and application-side maximum cost.
- Calculate the confirmation estimate using five times the documented 2026-08-13 Luna token prices. Input bytes are treated as an upper bound on input tokens. This estimate is deliberately conservative but does not replace an OpenAI project spend limit.
- Require `--confirm-max-cost-cents` to equal the calculated maximum exactly.
- Reserve the output path and write a durable `.attempt.json` marker before the network request. A failed or interrupted attempt is not automatically retried.
- Disable model tools and reject refusals, incomplete responses, HTTP errors, changed IDs, slugs, schedules, source URLs, and unsafe article content.
- Never log the API key or an API error body.

## Consequences

The adapter can make a bounded paid request only after explicit local configuration and exact cost confirmation. The generated response still must pass the independent ADR 0018 import step before entering an article queue. Operators must configure OpenAI project-level spend limits because local estimates cannot guarantee provider billing. Model expansion, web search, automatic retries, source fetching, parallel calls, or unattended execution require separate review.

## Official references

- [OpenAI model catalog](https://developers.openai.com/api/docs/models)
- [GPT-5.6 Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
