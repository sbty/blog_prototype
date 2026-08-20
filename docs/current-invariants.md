# Current Invariants

## Purpose

This document defines the current safety and architectural invariants of the Google Blogger automation system.

These rules should be checked before modifying draft, scheduling, browser automation, approval, audit, or execution logic.

Do not weaken an invariant merely to make an implementation or test pass.

If a requested change genuinely requires changing an invariant, treat that as an architectural change and inspect the relevant ADRs before implementation.

---

## 1. Explicit Mutation Boundary

Read-only operations and mutating operations must remain distinguishable.

A workflow that inspects, audits, previews, lists, or validates data must not unexpectedly mutate Blogger state.

Examples of read-oriented operations include:

```text
inspection
listing
audit
preview
preflight
validation
```

Mutation must occur only through an explicitly mutating workflow.

---

## 2. Draft and Scheduled Execution Are Separate Boundaries

Saving a Blogger draft and executing a scheduled-post workflow are separate capabilities.

A code path that is authorized to create or modify a draft must not automatically gain permission to perform scheduled execution.

Do not bypass this separation for implementation convenience.

---

## 3. Scheduling Requires Explicit Preparation

Scheduled execution must operate on prepared scheduling data rather than arbitrary article input.

The single-job scheduled-post flow is:

```text
content
↓
schedule plan
↓
approval
↓
readiness
↓
non-mutating browser preview
↓
preview confirmation
↓
execution-package preparation
↓
execution-package audit
↓
explicit execution confirmation
↓
scheduled execution
```

Do not create shortcuts from raw content directly to scheduled execution unless the architecture is intentionally changed.

---

## 4. Approval Must Correspond to the Executed Artifact

Approval or confirmation must apply to the same scheduling artifact that is eventually executed.

Code must not silently modify material scheduling information after approval in a way that invalidates the approval relationship.

Where integrity validation already exists, preserve it.

Relevant implementation areas include:

```text
scheduleApprovalIntegrity.ts
scheduleApprovalService.ts
scheduleArtifactValidation.ts
scheduleExecutionPackageService.ts
scheduleExecutionPackageAuditService.ts
```

---

## 5. Preflight Failures Are Blocking

A failed preflight, readiness check, validation, or integrity check must not be converted into success solely so that execution can continue.

Errors should be surfaced with enough context to diagnose the failure.

Prefer fixing the input or underlying implementation over weakening validation.

---

## 6. Audit Failures Must Not Be Silently Ignored

Content and execution audit layers exist to prevent invalid or incomplete artifacts from continuing through the workflow.

Relevant areas include:

```text
contentBatchAuditService.ts
draftAuditValidation.ts
publishedPostAuditService.ts
scheduleExecutionPackageAuditService.ts
```

If an audit intentionally permits a warning rather than an error, that behavior should be explicit.

---

## 7. Browser Identity Must Be Verified Where Required

Browser automation must not assume that the currently active Blogger editor corresponds to the intended blog, or that the session is authenticated and has access.

Existing identity/session guards must not be bypassed merely because the browser appears to be on the expected page.

Relevant modules include:

```text
bloggerEditorIdentity.ts
bloggerSessionGuard.ts
chromeProfile.ts
```

---

## 8. Blogger Selectors Are Centralized

Blogger DOM selectors should use the existing selector abstraction/configuration where applicable.

Relevant files include:

```text
src/browser/bloggerSelectors.ts
config/blogger-selectors.json
```

Do not scatter new hard-coded selectors across unrelated services unless there is a specific reason.

Browser UI changes should preferably be handled in the browser layer.

---

## 9. Browser Logic Must Not Leak Into Domain Logic

Blogger DOM operations, browser sessions, selectors, page navigation, and upload mechanics belong in the browser layer.

Domain models should not depend on Blogger DOM implementation details.

Application services may orchestrate browser operations but should not duplicate browser internals.

---

## 10. Persistence Must Use Repository Boundaries

Persistent article, blog, job, and database state should use the repository layer.

Relevant files:

```text
articleRepository.ts
blogRepository.ts
jobRepository.ts
database.ts
```

Do not introduce ad-hoc persistence mechanisms inside services when an existing repository abstraction applies.

---

## 11. Content Generation and Blogger Mutation Are Separate Concerns

AI article generation must not implicitly cause Blogger mutation.

Generation/import should produce or update local application artifacts.

AI-assisted content remediation must likewise remain local until a corrected batch passes the ordinary content audit and enters an explicit Blogger workflow.

Blogger draft or scheduling operations should occur through their explicit workflows.

Relevant generation components include:

```text
openAIArticleGenerationService.ts
articleGenerationPackageService.ts
generatedArticleImportService.ts
generatedArticleBatchCompilerService.ts
contentRemediationPackageService.ts
contentRemediationImportService.ts
```

---

## 12. Sources and Images Must Remain Associated With the Correct Content

Batch source and image attachments must remain associated with the intended article/batch.

Do not silently reuse an attachment from another article, blog, or batch when identity cannot be established.

Relevant components include:

```text
batchImageAttachmentService.ts
batchSourceAttachmentService.ts
bloggerImageUploader.ts
imageFile.ts
```

---

## 13. Multi-Blog Routing Must Be Explicit

The project supports multiple Blogger blogs.

Blog identity must therefore be treated as explicit application data rather than inferred from whichever Blogger page is currently open.

Operations must target the intended blog configuration.

Relevant areas include:

```text
blogConfig.ts
blogRepository.ts
articleQueueRoutingService.ts
bloggerEditorIdentity.ts
```

---

## 14. Dry Run Must Remain Non-Destructive

Dry-run behavior must not perform an unintended external mutation.

Existing dry-run guards should not be removed to simplify testing.

Relevant files include:

```text
bloggerDryRun.ts
dryRunNetworkGuard.ts
dryRunService.ts
```

If a feature cannot be accurately simulated in dry-run mode, report the limitation rather than silently performing the live action.

---

## 15. Recovery and Retry Must Preserve Identity

Retry and recovery workflows must retain enough identity information to ensure that the retried operation corresponds to the original intended:

```text
article
batch
blog
campaign
schedule item
```

Retries must not accidentally execute a different item because of ordering or regenerated IDs.

Relevant areas include:

```text
contentAuditRetryService.ts
contentRemediationPackageService.ts
contentRemediationImportService.ts
scheduleCampaignItemRecoveryService.ts
scheduleBatchExecutionService.ts
```

---

## 16. Tests Must Not Be Satisfied by Removing Safety Checks

When a test fails after a change:

Preferred:

```text
understand invariant
→ identify regression
→ repair implementation
→ verify test
```

Avoid:

```text
test fails
→ remove validation
→ weaken guard
→ broaden authorization
```

A safety-oriented failing test is evidence to investigate, not automatically an obsolete constraint.

---

## 17. Use the Narrowest Relevant Context

When implementing a change, Codex should not inspect the entire repository by default.

Typical lookup strategy:

### Blogger UI problem

Read:

```text
src/browser/
config/blogger-selectors.json
corresponding browser test
calling service if necessary
```

### Draft problem

Read:

```text
draft-related service
corresponding test
relevant browser module
```

### Content-generation problem

Read:

```text
article-generation domain/service
corresponding test
relevant example JSON
```

### Scheduling problem

Read:

```text
relevant schedule service
corresponding test
current scheduling documentation
specific ADR only if necessary
```

---

## 18. ADRs Are Historical Context

Do not assume that every ADR describes the complete current system.

Later ADRs may extend or supersede earlier decisions.

When investigating history:

1. start from current code;
2. identify the subsystem involved;
3. search for ADRs related to that subsystem;
4. read only the relevant ADR sequence.

Do not read ADR `0001` through the latest ADR simply to begin a normal implementation task.

---

## 19. Prefer Existing Abstractions

Before creating a new:

```text
service
repository
domain type
browser helper
validation layer
batch format
```

check whether an existing component already owns that responsibility.

Prefer extending the existing abstraction when it remains conceptually correct.

Avoid parallel implementations of the same workflow.

---

## 20. Keep Changes Local by Default

For ordinary bug fixes and incremental features:

- minimize the number of changed files;
- avoid unrelated cleanup;
- avoid mass renames;
- avoid directory-wide refactoring;
- preserve public interfaces when possible;
- update the directly related tests.

Broader refactoring should be deliberate rather than incidental.

---

## When an Invariant Appears Wrong

If current implementation requirements conflict with this file:

1. do not silently ignore the conflict;
2. inspect the relevant current tests;
3. inspect the specific ADRs for that subsystem;
4. determine whether this document is outdated or the requested change alters architecture;
5. update this document if the accepted architecture changes.

This document should describe the **current system**, not preserve obsolete rules indefinitely.
