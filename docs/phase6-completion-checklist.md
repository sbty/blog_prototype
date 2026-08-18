# Phase 6 local content-pipeline completion checklist

## Completed implementation

- [x] Validate completed article candidates and route them to explicit or uniquely matching blog taxonomies without opening Blogger.
- [x] Export provider-neutral generation packages without Blogger administration URLs, public URLs, editor URLs, selectors, or credentials.
- [x] Strictly import generated responses only when request IDs, slugs, schedules, safe HTML, and exact HTTPS source attestations match the plan.
- [x] Keep OpenAI generation disabled by default and require an allowlisted model, API key, bounded request size, exact maximum-cost confirmation, `store: false`, no tools, and a durable no-retry attempt marker.
- [x] Compile generated responses directly into the existing multi-blog batch contract while preserving generation request IDs and source URLs.
- [x] Attach exactly one validated, unique local image to every blog/article assignment without overwriting existing article images.
- [x] Compile generated responses and corresponding images into a complete multi-blog batch in one local command.
- [x] Reject existing output paths before writing and keep all compilation commands independent from the database, browser, Blogger, and provider network calls.
- [x] Preserve all Phase 2 through Phase 5 STOP, feature-flag, blog-allowlist, evidence, duplicate, schedule, and execution boundaries.

## Verification

- [x] `npm run verify:phase6` passes scoped formatting, blog-example formatting, ESLint, TypeScript compilation, the complete automated test suite, and built scheduled-execution boundary verification.
- [x] Multi-blog and multi-article automated coverage verifies generation-plan ordering, explicit blog assignment, source provenance, and one corresponding image per article.
- [x] A local CLI acceptance compiles a generation plan, generated responses, and validated image assignment into a complete batch without external communication.
- [x] Runtime evidence, generated content, images, Blogger identifiers, profiles, credentials, build output, and dependencies remain ignored by Git.

## Deliberately excluded

- Automated topic discovery or source-URL discovery.
- Network retrieval or independent factual verification of cited sources.
- Image generation or selection from external services.
- Unattended paid generation, automatic retries, model expansion, provider tools, or background scheduling.
- Additional Blogger draft saves, schedule confirmations, publications, repairs, or deletions without explicit authorization.
- Production-blog rollout or removal of existing execution safety gates.

These exclusions are separate future capabilities, not incomplete Phase 6 acceptance items.
