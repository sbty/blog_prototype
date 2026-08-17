# ADR 0021: Local batch image attachments

## Status

Accepted as the fifth Phase 6 capability.

## Context

Generated articles can be compiled into a multi-blog batch, and the existing draft and schedule workflows can upload an `imagePath`. Without a batch-level image assignment step, operators must edit every article JSON or repair images after Blogger drafts have already been saved.

## Decision

- Add `attach-batch-images --manifest <path> --images <path> --output <path>` as a database-free local command.
- Identify each assignment by the exact `blogKey` and article `slug` pair.
- Require exactly one assignment for every batch item and reject missing, unknown, or duplicate assignments.
- Reject batches whose articles already contain `imagePath` instead of silently replacing an image.
- Validate each local image with the existing Blogger image boundary, including extension, file type, physical regular-file status, non-empty size, 10 MiB limit, and symbolic-link rejection.
- Resolve validated image paths to physical absolute paths and reject reuse of one physical file across multiple batch items.
- Validate the complete result with the existing batch schema before creating, but never overwriting, the output file.
- Do not generate images, open a browser, contact Blogger, or grant authority to execute the resulting batch.

## Consequences

Multiple generated articles can receive their corresponding images before the first dry-run, draft save, or schedule preparation. The existing batch executor performs the actual upload only when its operation-specific feature flags and safety boundaries are separately satisfied.
