# Phase 2 completion checklist

Run the complete local gate with:

```bash
npm run verify:phase2
```

## Local implementation: complete

- [x] Draft saving requires `ENABLE_DRAFT_SAVE=true` and `ENABLE_SCHEDULED_POST=false`.
- [x] Publish and schedule-confirmation controls are outside the draft workflow.
- [x] STOP is checked at startup and at every browser mutation boundary.
- [x] Session, CAPTCHA, access, origin, editor identity, and target blog are validated.
- [x] Exact-title duplicate drafts are audited before saving.
- [x] Title, body, images, labels, description, slug, and schedule preview have guarded input/readback checks.
- [x] The persisted edit URL, blog ID, canonical save timestamp, and PNG evidence are validated.
- [x] Job state, events, and artifacts are recorded only after evidence validation.
- [x] The final source audit found no Phase 2 TODO/FIXME or unimplemented branch.
- [x] The draft workflow contains no publish or schedule-confirmation execution path.
- [x] Lint, TypeScript build, and the complete automated test suite pass.

## Live acceptance: complete

- [x] Saved one draft to the locally configured dedicated test blog and validated the persisted edit URL and local evidence (`2026-08-03 JST`, job `draft-2026-08-02T18-31-21-719Z-8bf3a20d-1189-49a8-b221-b06448c2bc54`, post `3979423979595250330`).
- [x] Re-ran the independent read-only duplicate audit after saving and confirmed exactly one matching draft with the same persisted edit URL.

The operator explicitly authorized this single draft save. No schedule confirmation or publication was performed, and those operations remain outside Phase 2.
