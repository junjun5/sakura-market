# AGENTS.md

Guidance for coding agents working in this repository.

## Commands

| Task                                                                           | Command                                                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Set up a fresh clone: install the pinned dev tools and the pre-commit hook     | `npm run setup`                                                         |
| Run all tests                                                                  | `npm test`                                                              |
| Run one test file                                                              | `node --test test/listings.test.js`                                     |
| Static checks: format, lint, types, dead code, duplicates, repo rules, docs    | `npm run check`                                                         |
| Tests with the coverage gate, writing `reports/junit.xml` (Node.js 22.8+)      | `npm run test:coverage`                                                 |
| Test timing report from `reports/junit.xml`                                    | `npm run test:report`                                                   |
| Run the suite 5 times and list flaky tests (`npm run test:flaky -- 10` for 10) | `npm run test:flaky`                                                    |
| Format every file / only check formatting                                      | `npm run format` / `npm run format:check`                               |
| One static check on its own                                                    | `npm run lint`, `npm run typecheck`, `npm run knip`, `npm run dup`      |
| List tracked tech debt markers                                                 | `npm run debt`                                                          |
| Regenerate `docs/api/README.md` from `docs/api/openapi.json`                   | `npm run docs:api`                                                      |
| CPU profile and latency percentiles under load (writes `.dev/profiles/`)       | `npm run profile`                                                       |
| Start the server in the foreground                                             | `npm start`                                                             |
| Start the server in the background                                             | `scripts/dev.sh start` (port 3000, or `PORT=4000 scripts/dev.sh start`) |
| Read server logs                                                               | `scripts/dev.sh logs`                                                   |
| Stop the server                                                                | `scripts/dev.sh stop`                                                   |
| Install the pre-commit hook only                                               | `scripts/install-hooks.sh`                                              |

Run `npm run check && npm test` before you call a task done. `npm run check` runs every step even after a failure and lists the failed ones at the end.

The pre-commit hook in `.githooks/pre-commit` runs the same gate on the staged files and blocks the commit if it fails. Fix the failure and stage the fix; do not bypass the hook with `--no-verify`.

## Architecture

- `src/app.js` is the only file that knows about HTTP. Add routes to the `routes` table there.
- `src/listings.js` holds business rules. It takes plain values and throws `AppError`. New domains get their own file next to it (for example `src/favorites.js`), shaped the same way: `createXService(store, options)`.
- `src/store.js` owns all data. Nothing else keeps state. Each `createStore()` call returns an isolated copy.
- `src/logger.js`, `src/metrics.js` and `src/flags.js` are the logger, the request metrics and the feature flags. `createApp()` takes all three as options so tests can inject them.
- `public/` is the browser client: plain DOM, no framework, no build step.
- `docs/architecture.md` shows how a request flows through these modules.

## Conventions

- Node.js 20+, ES modules, no runtime dependencies. Dev dependencies are for tooling only (ESLint, Prettier, TypeScript, knip, jscpd), pinned to exact versions in `package.json` and `package-lock.json`. Install with `npm ci`. Add a dev tool only when the task needs it, and only a release that has been public for at least 7 days.
- Types: JSDoc annotations, checked by `tsc` in strict mode (`tsconfig.json`) for `src/`, `public/` and `scripts/`. Tests are not type-checked.
- Code-quality limits are ESLint errors (`eslint.config.js`): cyclomatic complexity 10, nesting depth 4, 4 parameters, 400 lines per file (800 for tests), no unused code, no `console` outside `scripts/`. Split a function instead of disabling a rule. knip fails on unused files, exports and dependencies; jscpd fails above 2% duplicated code.
- Errors: throw helpers from `src/errors.js`. The response shape is `{ error: { code, message } }` with a snake_case `code`.
- Auth is a mock: `X-User-Id` header, checked by `requireUser` in `src/app.js`.
- IDs are short strings (`u1`, `l1`). Timestamps are ISO 8601 strings in UTC.
- Money is an integer number of yen in a field ending with `Yen`.
- Limits and enumerations are exported constants (see the top of `src/listings.js`), not inline numbers.
- Logging: use the logger passed to `createApp()` (`createLogger()` from `src/logger.js`). It writes one JSON object per line and redacts every field. Give each line a short snake_case message and put the details in fields, including `requestId` when there is a request.
- Request IDs: every response has an `X-Request-ID` header. A caller's well-formed ID is reused, otherwise one is generated. The access log line of each request carries the same ID.
- Feature flags: declare each flag with its default and a description in `FLAGS` in `src/flags.js`, read it with `flags.isEnabled('name')`, and switch it with the `FEATURE_FLAGS` environment variable (`.env.example`). Remove a flag and its dead branch once it is permanently on or off; `test/flags.test.js` fails for a declared flag that no code reads.
- Tech debt: a `TODO`, `FIXME`, `HACK` or `XXX` comment must name its issue, as in `TODO(#123): ...`. `npm run check` rejects bare markers.
- API changes: describe every route change in `docs/api/openapi.json`, then run `npm run docs:api`. `test/openapi.test.js` fails when the routes or responses differ from the schema.

## Tests

- Test files are `test/<topic>.test.js` in kebab-case; shared helpers live in `test/support/`. `npm run check` rejects other names.
- Unit tests call the service with a fresh `createStore()`.
- API tests start a real server on a random port with `withServer` from `test/support/server.js` and use `fetch`.
- Every new rule needs a unit test. Every new route needs an API test, including its error cases, and an entry in `docs/api/openapi.json`.
- Coverage gate (`npm run test:coverage`, run in CI): 95% of lines, 90% of branches and 95% of functions in `src/` and `public/`.
- Keep tests fast and independent: no shared state between tests, no fixed ports, no sleeping for timing. CI warns about tests slower than 2 s and fails when the suite takes more than 30 s of test time.
- There are no browser tests. To check the UI, start the server and exercise the page.

## Debugging and operations

- Runbooks for local debugging are in `docs/runbooks/`: following one request through the logs by its request ID, reading `GET /api/metrics`, profiling, and releasing.
- Skills for common tasks are in `.factory/skills/`.

## Security

- Secrets: never put credentials, tokens or real personal data in code, tests, fixtures or logs. Local settings go in `.env` (gitignored). List every variable in `.env.example` with a safe default. CI reads secrets only as `${{ secrets.NAME }}`. Test data uses the seed users and obviously fake values such as `not-a-real-token`.
- Logging: everything goes through the logger, which passes every field through `redact()` from `src/redact.js`. Never write raw headers or bodies with `console` or `process.stdout`. `X-User-Id` counts as a credential.
- Dependencies: third-party code is the dev tools in `package.json` and the GitHub Actions in `.github/workflows/`, pinned to commit SHAs. Dependabot proposes updates for both only after a release has been public for 7 days (`cooldown` in `.github/dependabot.yml`). Do not bump a pin to a release younger than that by hand.
- Changes land on `main` through a pull request with the `check-and-test` CI check passing; force-push and branch deletion are blocked. The rule is the ruleset in `.github/rulesets/protect-main.json`; a repository admin applies it with `gh api -X POST repos/junjun5/sakura-market/rulesets --input .github/rulesets/protect-main.json`.
- Security checks in CI: gitleaks secret scan and an OWASP ZAP baseline scan of the running server (`.github/workflows/security.yml`, rule levels in `.zap/rules.tsv`), plus CodeQL (`.github/workflows/codeql.yml`).
- Issues and PRs use the templates in `.github/`. Labels are defined in `.github/labels.yml` (`priority: P0`-`P3`, `type: *`, `area: *`) and synced by a workflow. Edit that file instead of creating labels by hand. Release notes are grouped by the `type: *` labels (`.github/release.yml`).

## Releases

- Bump `version` in `package.json` in a pull request, merge it, then push a tag `v<version>` on `main`. `.github/workflows/release.yml` runs the gate and publishes a GitHub Release with generated notes. See `docs/runbooks/releases.md`.

## Boundaries

- Keep data in memory. Do not add a database.
- Do not change the behaviour of existing routes unless the task says so.
- Product requirements live in `docs/prd/`. Treat anything listed there as out of scope as out of scope.
