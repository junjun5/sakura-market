# AGENTS.md

Guidance for coding agents working in this repository.

## Commands

| Task | Command |
| --- | --- |
| Run all tests | `npm test` |
| Run one test file | `node --test test/listings.test.js` |
| Syntax check | `npm run check` |
| Start the server in the background | `scripts/dev.sh start` (port 3000, or `PORT=4000 scripts/dev.sh start`) |
| Read server logs | `scripts/dev.sh logs` |
| Stop the server | `scripts/dev.sh stop` |
| Install the pre-commit hook (once per clone) | `scripts/install-hooks.sh` |

Run `npm run check && npm test` before you call a task done.

The pre-commit hook in `.githooks/pre-commit` runs the same gate on the staged files and blocks the commit if it fails. Fix the failure and stage the fix; do not bypass the hook with `--no-verify`.

## Architecture

- `src/app.js` is the only file that knows about HTTP. Add routes to the `routes` table there.
- `src/listings.js` holds business rules. It takes plain values and throws `AppError`. New domains get their own file next to it (for example `src/favorites.js`), shaped the same way: `createXService(store, options)`.
- `src/store.js` owns all data. Nothing else keeps state. Each `createStore()` call returns an isolated copy.
- `public/` is the browser client: plain DOM, no framework, no build step.

## Conventions

- Node.js 20+, ES modules, no runtime dependencies and no dev dependencies. Do not add packages.
- Errors: throw helpers from `src/errors.js`. The response shape is `{ error: { code, message } }` with a snake_case `code`.
- Auth is a mock: `X-User-Id` header, checked by `requireUser` in `src/app.js`.
- IDs are short strings (`u1`, `l1`). Timestamps are ISO 8601 strings in UTC.
- Money is an integer number of yen in a field ending with `Yen`.
- Limits and enumerations are exported constants (see the top of `src/listings.js`), not inline numbers.

## Tests

- Unit tests call the service with a fresh `createStore()`.
- API tests start a real server on a random port with `withServer` in `test/api.test.js` and use `fetch`.
- Every new rule needs a unit test. Every new route needs an API test, including its error cases.
- There are no browser tests. To check the UI, start the server and exercise the page.

## Security

- Secrets: never put credentials, tokens or real personal data in code, tests, fixtures or logs. Local settings go in `.env` (gitignored). List every variable in `.env.example` with a safe default. CI reads secrets only as `${{ secrets.NAME }}`. Test data uses the seed users and obviously fake values such as `not-a-real-token`.
- Logging: pass anything that can contain request data through `redact()` from `src/redact.js` before you log it. Never log raw headers or bodies. `X-User-Id` counts as a credential.
- Dependencies: the only third-party code is the GitHub Actions in `.github/workflows/`, pinned to commit SHAs. Dependabot proposes updates only after a release has been public for 7 days (`cooldown` in `.github/dependabot.yml`). Do not bump a pin to a release younger than that by hand.
- Changes land on `main` through a pull request with the `check-and-test` CI check passing; force-push and branch deletion are blocked. The rule is the ruleset in `.github/rulesets/protect-main.json`; a repository admin applies it with `gh api -X POST repos/junjun5/sakura-market/rulesets --input .github/rulesets/protect-main.json`.
- Security checks in CI: gitleaks secret scan and an OWASP ZAP baseline scan of the running server (`.github/workflows/security.yml`, rule levels in `.zap/rules.tsv`), plus CodeQL (`.github/workflows/codeql.yml`).
- Issues and PRs use the templates in `.github/`. Labels are defined in `.github/labels.yml` (`priority: P0`-`P3`, `type: *`, `area: *`) and synced by a workflow. Edit that file instead of creating labels by hand.
## Boundaries

- Keep data in memory. Do not add a database.
- Do not change the behaviour of existing routes unless the task says so.
- Product requirements live in `docs/prd/`. Treat anything listed there as out of scope as out of scope.
