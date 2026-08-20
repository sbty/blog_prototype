# Current Architecture

## Purpose

This document describes the **current architecture** of the Google Blogger automation system.

Use this document as the primary architecture reference when modifying the repository.

Do not read all ADRs by default.

ADRs under `docs/adr/` are historical decision records. Read a specific ADR only when:

- the current implementation is unclear;
- the reason behind an architectural decision is required;
- a proposed change may conflict with an existing safety boundary;
- this document explicitly references the ADR.

---

## System Goal

This project automates a multi-blog Google Blogger content workflow.

The system is responsible for processing article data, preparing content batches, validating content, attaching sources and images, saving Blogger drafts, preparing scheduled-post workflows, and executing explicitly authorized operations.

The system is designed around **controlled state transitions and explicit safety boundaries**.

---

## High-Level Flow

Content processing branches by the requested batch operation:

```text
Article input / article queue
        ↓
Optional article generation
        ↓
Generated article import
        ↓
Content batch compilation
        ↓
Source / image attachment
        ↓
Batch operation
├─ dry-run
├─ save-drafts
│  ↓
│  Content audit
│  ├─ PASS → Blogger draft save
│  └─ FAIL → remediation package
│            ↓
│            corrected response import
│            ↓
│            content re-audit
└─ plan-schedules
   ↓
   schedule plan
   ↓
   approval
   ↓
   readiness and non-mutating browser preview
   ↓
   preview confirmation
   ↓
   execution package and package audit
   ↓
   explicitly confirmed scheduled execution
```

Not every command uses the entire flow.

When modifying a subsystem, inspect only the relevant layer and its directly related dependencies unless broader investigation is necessary.

---

## Main Repository Areas

### `src/domain/`

Contains domain models and business data structures.

Examples:

- articles
- article generation
- article queues
- batches
- batch images
- batch sources
- jobs
- schedule batches
- schedule campaigns

Domain code should remain independent from browser-specific implementation wherever practical.

---

### `src/services/`

Contains application workflow and orchestration logic.

Major functional groups are described below.

#### Content generation and compilation

Relevant files include:

```text
articleGenerationPackageService.ts
articleQueueRoutingService.ts
generatedArticleImportService.ts
generatedArticleBatchCompilerService.ts
contentBatchCompilerService.ts
openAIArticleGenerationService.ts
```

Responsibilities include:

- article-generation preparation;
- generated article import;
- article routing;
- conversion into content batches;
- AI generation integration.

---

#### Sources and images

Relevant files include:

```text
batchImageAttachmentService.ts
batchSourceAttachmentService.ts
draftSourceUpdateService.ts
```

Responsibilities include:

- associating images with content batches;
- associating source information;
- updating authorized draft source data.

Browser-level image upload behavior belongs in `src/browser/`.

---

#### Content auditing and remediation

Relevant files include:

```text
contentBatchAuditService.ts
contentAuditRetryService.ts
contentRemediationPackageService.ts
contentRemediationImportService.ts
draftAuditValidation.ts
publishedPostAuditService.ts
```

Responsibilities include:

- validating prepared content;
- identifying content that requires remediation;
- generating remediation requests and importing validated corrected responses into retry batches;
- inspecting draft or published-post state where applicable.

Audit failures must not be bypassed merely to allow execution to continue.

---

#### Draft workflow

Relevant files include:

```text
draftSaveService.ts
draftSaveValidation.ts
draftSourceUpdateService.ts
dryRunService.ts
```

Browser implementation related to draft operations is located under:

```text
src/browser/
```

Draft operations and scheduled-post execution should be treated as separate workflow boundaries.

---

#### Scheduled-post workflow

Relevant files include:

```text
approvedSchedulePreviewService.ts
scheduleApprovalIntegrity.ts
scheduleApprovalService.ts
scheduleArtifactValidation.ts
scheduleBatchExecutionService.ts
scheduleBatchInspectionService.ts
scheduleBatchListService.ts
scheduleCampaignInspectionService.ts
scheduleCampaignItemRecoveryService.ts
scheduleCampaignListService.ts
scheduleCampaignPreflightService.ts
scheduleCampaignPreparationService.ts
scheduleCancellationService.ts
scheduleEvidencePreparationService.ts
scheduleExecutionPackageAuditService.ts
scheduleExecutionPackageService.ts
schedulePlanService.ts
schedulePreviewConfirmationService.ts
scheduleReadinessService.ts
scheduledPostExecutionBoundary.ts
scheduledPostExecutionService.ts
```

The single-job scheduled-post workflow intentionally separates:

```text
planning
→ approval
→ readiness
→ non-mutating browser preview
→ preview confirmation
→ execution-package preparation
→ execution-package audit
→ explicitly confirmed execution
```

Schedule batch and campaign preparation, preflight, inspection, listing, and recovery are separate supporting workflows rather than mandatory steps in every single-job execution path.

Do not collapse these stages without first checking the associated safety invariants and relevant ADRs.

---

## Browser Automation Layer

`src/browser/` contains Blogger-specific browser automation and browser-state validation.

Relevant areas include:

```text
bloggerDraftSources.ts
bloggerDryRun.ts
bloggerEditorIdentity.ts
bloggerImageUploader.ts
bloggerPostSettings.ts
bloggerSchedulePreview.ts
bloggerSelectors.ts
bloggerSessionGuard.ts
chromeProfile.ts
dryRunNetworkGuard.ts
imageFile.ts
```

`config/blogger-selectors.json` contains Blogger selector configuration.

When working on Blogger UI automation:

1. inspect the relevant browser module;
2. inspect `config/blogger-selectors.json` if selectors are involved;
3. inspect the directly corresponding tests;
4. inspect the calling service only if necessary.

Do not scan unrelated scheduling or content-generation modules by default.

---

## Repository Layer

`src/repositories/` handles persistence.

Relevant files:

```text
articleRepository.ts
blogRepository.ts
database.ts
jobRepository.ts
```

Application services should use repository abstractions rather than duplicating persistence logic.

---

## CLI Layer

CLI behavior is located under:

```text
src/cli/
```

Relevant files:

```text
args.ts
index.ts
operationalCli.ts
```

The CLI should orchestrate existing services rather than reimplement domain or workflow logic.

---

## Configuration

Configuration is primarily located under:

```text
src/config/
config/
.env
```

Tracked configuration files include:

```text
src/config/blogConfig.ts
src/config/env.ts
config/blogger-selectors.json
```

`.env.example` documents environment variables.

Secrets must not be committed to the repository.

---

## Examples

`examples/` contains example input/output artifacts.

Use only the examples relevant to the subsystem being modified.

### Content-related examples

```text
article.example.json
article-generation-plan.example.json
article-queue.example.json
batch.example.json
batch-images.example.json
batch-sources.example.json
generated-article-responses.example.json
content-remediation-package.example.json
content-remediation-responses.example.json
```

### Blog configurations

```text
*.blog.json
```

### Scheduling examples

```text
schedule-approval-batch.example.json
schedule-campaign.example.json
schedule-execution-batch.example.json
schedule-preparation-batch.example.json
```

Do not load all example files unless the task actually spans multiple subsystems.

---

## Tests

Tests are stored under:

```text
src/tests/
```

Most production modules have a directly corresponding test file.

When modifying a module:

1. inspect its corresponding test first or alongside the implementation;
2. run the narrowest relevant test set during iteration;
3. run the broader validation suite before considering the task complete.

Avoid reading every test file when a task affects only one subsystem.

---

## Architecture Decision Records

Historical decisions are stored under:

```text
docs/adr/
```

Important rule:

> ADRs explain how and why the project reached its current architecture. They are not the default entry point for understanding current behavior.

Use this document and `docs/current-invariants.md` first.

Search ADRs selectively when historical rationale is necessary.

---

## Current Architectural Principle

Prefer:

```text
small targeted change
+ existing service
+ existing domain model
+ corresponding test
```

over:

```text
new parallel abstraction
+ duplicated workflow
+ broad repository refactor
```

unless the task explicitly requires an architectural change.

---

## Documentation Priority

When sources disagree, use the following order:

1. current code and tests;
2. `docs/current-invariants.md`;
3. this document;
4. current operational/runbook documentation;
5. relevant ADR;
6. older completion checklists.

If documentation conflicts with tested current implementation, identify the conflict rather than silently assuming the older document is authoritative.
