# Contributing

## Workflow

The `main` branch is protected. Create a short-lived branch, push it, and open a pull request. Merge only after the required `verify` check succeeds and all conversations are resolved. Keep history linear.

```powershell
git switch -c codex/<short-description>
npm ci
npm run audit:dependencies
npm run verify:local-complete
git push -u origin codex/<short-description>
```

## Safety rules

- Never commit `.env`, `data`, `dist`, `node_modules`, a Chrome profile, credentials, or real Blogger identifiers.
- Keep `ENABLE_DRAFT_SAVE=false` and `ENABLE_SCHEDULED_POST=false` for ordinary development and CI.
- Treat execution packages and audit evidence as evidence only, not as permission to mutate Blogger.
- Do not save, schedule, publish, repair, rename, or delete a Blogger post without explicit authorization for that exact operation.
- Do not weaken STOP checks, exact evidence matching, bounded resume markers, timezone validation, or the configured dedicated-blog boundary.
- Use fictional IDs and `example.blogspot.com` in tracked examples and tests.

## Required checks

Before opening a pull request, run:

```powershell
npm run audit:dependencies
npm run verify:local-complete
```

The same checks run in GitHub Actions. Moderate-or-higher dependency findings fail CI.

## Operational changes

Changes that affect Blogger mutations, permissions, retry behavior, credentials, scheduling semantics, or production rollout require separate acceptance criteria and an ADR. Keep operational recovery documentation synchronized with behavior.
