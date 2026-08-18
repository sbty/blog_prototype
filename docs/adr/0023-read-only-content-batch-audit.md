# ADR 0023: Read-only content batch audit

## Status

Accepted as the first Phase 7 capability.

## Context

Phase 6 can create complete provenance-bearing, image-bearing batches, but a structurally valid batch can still contain an article that is too short, omits its planned source links, references an invalid image, exceeds Blogger's search-description limit, or conflicts with the blog's excluded topics. These problems should be visible before any browser or Blogger operation.

## Decision

- Add `audit-content-batch --manifest <path> --output <path>` as a database-free, browser-free, read-only command.
- Validate the input with the complete existing batch schema.
- Count visible non-whitespace Unicode characters and compare them with the target blog's configured length range.
- Require generation request and HTTPS source provenance, and require every provenance source to appear as an exact normalized HTTPS link in article HTML.
- Validate the existing local image file with the same physical-file, type, size, and symbolic-link checks used before Blogger upload.
- Treat missing provenance, missing source citations, invalid target length, search descriptions over 150 characters, excluded topics, and missing or invalid images as errors.
- Report missing h2 headings, labels, and titles over 100 characters as warnings.
- Write a new audit report without overwriting input or existing output, then return a failing process status when any article has an error.
- Do not modify the batch, database, browser profile, Blogger, source websites, images, or provider state.

## Consequences

Operators and later automation can inspect one durable report before deciding whether a content batch is ready for a dry-run or explicitly authorized draft workflow. This audit confirms structural and declared-source requirements; it does not independently verify factual accuracy, source quality, copyright status, or editorial judgment.
