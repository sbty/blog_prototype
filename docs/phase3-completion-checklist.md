# Phase 3 local workflow completion checklist

Run the complete local gate with:

```bash
npm run verify:phase3
```

## Local implementation: complete

- [x] Planning enforces future-time and current system/blog quota limits.
- [x] Approval requires an exact job-ID confirmation and an intact plan hash.
- [x] Plan, approval, readiness, preview, and confirmation artifacts use strict contracts.
- [x] Job IDs, SHA-256 values, and artifact timestamps form one validated chain.
- [x] STOP is checked at entry and immediately before local artifacts or state transitions.
- [x] Browser preview blocks mutation requests and validates sanitized telemetry.
- [x] Browser editor URLs and PNG evidence are validated before recording.
- [x] Preview confirmation keeps `executionEnabled=false` and performs no Blogger mutation.
- [x] Cancellation is explicit, guarded, and releases local quota.
- [x] Read plan and approval evidence only from regular files that physically resolve inside each job artifact directory.
- [x] Lint, TypeScript build, and the complete automated test suite pass.

## Dedicated test blog acceptance

- [x] Completed one live read-only Blogger preview acceptance (`2026-08-03 JST`, job `dryrun-2026-08-03T00-26-07-677Z-9b328f1a-4ecd-466d-9059-aa5afeac6c2d`); validated editor identity, settings readback, PNG evidence, and 18 blocked mutation requests.
- [x] Confirmed one dedicated-test-blog schedule manually after the automated final-confirmation selector stopped safely; later verified exactly one published post and one public image.

The acceptance exception is restricted to the locally configured dedicated test blog and the recorded job. It does not authorize another post or generalized execution.
