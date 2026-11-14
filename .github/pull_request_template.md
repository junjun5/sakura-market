## Summary

<!-- What does this change do, in one or two sentences? -->

## Why

<!-- The problem or requirement behind it. Link the issue or PRD (docs/prd/) if there is one. -->

Closes #

## Changes

<!-- The main changes, one bullet each. Call out any change to an existing route's behaviour. -->

-

## Testing

- [ ] `npm run check && npm test` passes
- [ ] New rules have unit tests; new routes have API tests, including error cases
- [ ] UI changes checked in a browser with `scripts/dev.sh start`

<!-- Anything else you ran or checked by hand, with the result. -->

## Security and docs

- [ ] No secrets, tokens or real personal data in code, tests, fixtures or logs
- [ ] New log output goes through `redact()` from `src/redact.js`
- [ ] README and AGENTS.md updated if routes, commands or conventions changed

## Notes for reviewers

<!-- Trade-offs, follow-ups, or anything you want a second opinion on. Delete if empty. -->
