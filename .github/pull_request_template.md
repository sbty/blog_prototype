## Summary

Describe what changed and why.

## Safety scope

- [ ] This PR does not authorize or perform a Blogger save, schedule, publish, repair, rename, or delete operation.
- [ ] No real blog ID, public blog URL, credential, `.env` value, browser profile, or runtime evidence is included.
- [ ] Mutation flags remain disabled unless a separately approved acceptance explicitly requires otherwise.
- [ ] Execution-boundary changes preserve fail-closed behavior and dedicated-blog restrictions.

## Verification

- [ ] `npm run audit:dependencies`
- [ ] `npm run verify:local-complete`
- [ ] Tests were added or updated when behavior changed.
- [ ] Documentation was updated when operational behavior changed.

## External effects

List any external state change. Write `None` for ordinary code and documentation PRs.
