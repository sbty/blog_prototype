# Phase 7 content-quality completion checklist

## Completed implementation

- [x] Preserve topic, search intent, and required points as `contentBrief`
      provenance from generated import through compilation, audit, remediation
      package creation, and corrected-content import.
- [x] Require source assignments to match existing generation request IDs and
      normalized source URLs before adding official-source citations.
- [x] Compile generated responses, images, and explicit source assignments into
      one locally validated batch without invoking Blogger or an AI provider.
- [x] Fail content containing known generic remediation boilerplate or
      unanchored terminology from unrelated domains, while allowing terminology
      explicitly anchored by the article brief.
- [x] Isolate generation and remediation prompts by request and prohibit generic
      cross-domain filler.
- [x] Require length-only remediation to preserve the existing HTML, title,
      labels, and search description while adding focused content.
- [x] Record provider-reported token usage and derive bounded usage cost evidence
      without weakening the existing preflight maximum-cost confirmation.
- [x] Sum estimates before isolated paid generation and maintain no-overwrite
      per-attempt and response evidence.

## Verification

- [x] `npm run verify:phase7` runs the Phase 7 incremental formatting check and
      the complete Phase 2-6 safety gate.
- [x] Automated tests cover `contentBrief` preservation, source-provenance
      conflicts, integrated source compilation, generic boilerplate, anchored and
      unanchored topic terminology, length-only preservation, token usage, and total
      budget enforcement.
- [x] The operational regression fixture contains article slugs and generic text
      markers only; it contains no Blogger blog ID, post ID, editor URL, credential,
      profile, or generated article body.
- [x] Validation requires no Blogger mutation and no paid provider request.

## Deliberately excluded

- Automatic web source discovery, source retrieval, or independent factual
  verification.
- Image generation or selection from an external service.
- Unattended paid generation, automatic provider retry, or background execution.
- Blogger draft saving, scheduling, publication, repair, or deletion without a
  separate explicitly authorized goal.
- Expanding topic-drift heuristics without a brief-anchored positive test and a
  concrete false-positive review.

These exclusions are future decisions, not incomplete Phase 7 acceptance items.
