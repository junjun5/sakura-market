# sakura-market-mini

A tiny C2C marketplace service: people list items, other people buy them, and
buyers can save listings to come back to later. It is a demo target for
agent-driven development, so it is small on purpose and has no runtime
dependencies beyond Node.js. The development tools (ESLint, Prettier,
TypeScript, knip, jscpd) are pinned dev dependencies.

## Run

Requires Node.js 20 or newer. The server needs nothing installed; for
development, install the pinned tools and the pre-commit hook once per clone:

```bash
npm run setup            # npm ci + scripts/install-hooks.sh
```

The repository also has a dev container (`.devcontainer/devcontainer.json`, Node.js 22)
that runs `npm run setup` for you.

```bash
npm start                # server in the foreground on http://localhost:3000
PORT=4000 npm start      # same, on another port
scripts/dev.sh start     # background server on http://localhost:3000 (PORT=4000 scripts/dev.sh start)
scripts/dev.sh status    # is the background server running?
scripts/dev.sh logs      # last 50 log lines (scripts/dev.sh logs 200 for more)
scripts/dev.sh stop
```

Open the server address in a browser to use the web page.

### Configuration

Copy `.env.example` to `.env` to change local settings. `.env` is gitignored,
and variables set in the shell override it. Loading `.env` needs Node.js 20.12 or newer.

| Variable        | Default | Meaning                                                                |
| --------------- | ------- | ---------------------------------------------------------------------- |
| `PORT`          | `3000`  | Port the server listens on                                             |
| `LOG_LEVEL`     | `info`  | Lowest log level written: `debug`, `info`, `warn`, `error` or `silent` |
| `FEATURE_FLAGS` | empty   | Flag overrides such as `metrics_endpoint=off` (flags: `src/flags.js`)  |

## Test

```bash
npm run check                      # format, lint, types, dead code, duplicates, repo rules, docs
npm test                           # unit + API tests (node:test)
node --test test/favorites.test.js # one test file
npm run test:coverage              # tests with the coverage gate (Node.js 22.8+), writes reports/
npm run test:report                # slowest tests from reports/junit.xml
npm run test:flaky                 # run the suite 5 times and list flaky tests
```

Run `npm run check && npm test` before calling a change done. The pre-commit
hook (installed by `npm run setup`, or `scripts/install-hooks.sh`) runs the same
gate on the staged version of the files, so unstaged edits and untracked files
do not affect the result.

Unit tests use a fresh in-memory store; API tests start a real server on a
random port. There are no browser tests: to check the page, start the server
and use it. AGENTS.md lists every command and the conventions the checks enforce.

## CI and security

Workflows in `.github/workflows/` run on every pull request and on pushes to `main`:

- `ci.yml`: `npm run check` and the tests with the coverage gate on Node.js 22, with a test timing summary and the `test-reports` artifact (JUnit, lcov), plus `npm test` on Node.js 20. The ruleset in `.github/rulesets/protect-main.json` requires its `check-and-test` job, and a pull request, for every change to `main`.
- `security.yml`: a gitleaks secret scan of the full history, and an OWASP ZAP baseline scan of the running server. The ZAP report is uploaded as the `zap-baseline` artifact, and its rule levels are in `.zap/rules.tsv`.
- `codeql.yml`: CodeQL static analysis. Results appear under Security > Code scanning.
- `sync-labels.yml`: applies `.github/labels.yml` to the repository's labels.
- `flaky-tests.yml`: weekly, runs the suite 10 times and fails on tests whose outcome changes.
- `release.yml`: on a `v*` tag, runs the gate and publishes a GitHub Release with generated notes (see `docs/runbooks/releases.md`).

Dependabot (`.github/dependabot.yml`) proposes weekly updates for the pinned
dev tools and Actions, but only for releases that are at least 7 days old. Every
log line goes through `src/redact.js`, which masks credentials (including
`X-User-Id`) and email addresses.

## Logs, metrics and debugging

- Logs are JSON lines (`scripts/dev.sh logs`). Each request writes one `request`
  line with its `requestId`, route pattern, status and duration.
- Every response has an `X-Request-ID` header; send your own to tag a request.
- `GET /api/metrics` serves request counts, latency histograms, uptime and memory
  in the Prometheus text format.
- `npm run profile` records a CPU profile under load in `.dev/profiles/`.
- Runbooks: `docs/runbooks/`. Request flow: `docs/architecture.md`.

## Using the web page

- **Signed in as** switches between the seed users Hana, Ken and Mio. Hearts,
  counts and the Saved view update for the selected user.
- **All listings** shows every listing. Use the search box and **On sale only**
  to filter it.
- Every card shows how many users saved it (for example `1 saved`). Cards for
  other users' listings have a heart button: press it to save the listing, press
  the filled heart to remove it. The page does not reload. Your own listings show
  the count but no heart.
- **Saved** shows only your saved listings, most recently saved first. Search
  and the on-sale filter do not apply there, and listings that were sold after
  you saved them stay in the list marked **Sold**. When nothing is saved, the
  view says so and offers a **Browse all listings** button.
- If saving fails, for example because you already saved 100 listings, the page
  shows the server's message and the heart and count go back to what they were.

## API

The full reference, generated from the OpenAPI schema `docs/api/openapi.json`,
is `docs/api/README.md`. All responses are JSON except `GET /api/metrics`, and every
response has an `X-Request-ID` header. Errors look like `{ "error": { "code": "...", "message": "..." } }`.
"Auth" is a mock: send `X-User-Id: u1` (Hana), `u2` (Ken) or `u3` (Mio).
Routes marked "yes" answer `401 unauthorized` without a known user.

| Method | Path                                  | Auth | What it does                                                                          |
| ------ | ------------------------------------- | ---- | ------------------------------------------------------------------------------------- |
| GET    | `/api/health`                         | no   | Liveness check                                                                        |
| GET    | `/api/metrics`                        | no   | Prometheus metrics (flag `metrics_endpoint`, on by default)                           |
| GET    | `/api/users`                          | no   | Seed users                                                                            |
| GET    | `/api/me`                             | yes  | The calling user                                                                      |
| GET    | `/api/listings?status=on_sale&q=text` | no   | List, filter by status, search by title                                               |
| GET    | `/api/listings/:id`                   | no   | One listing                                                                           |
| POST   | `/api/listings`                       | yes  | Create a listing (`title`, `description`, `priceYen`)                                 |
| PATCH  | `/api/listings/:id`                   | yes  | Change the title, description or price of your on-sale listing; returns `{ listing }` |
| POST   | `/api/listings/:id/purchase`          | yes  | Buy a listing                                                                         |
| PUT    | `/api/listings/:id/favorite`          | yes  | Save a listing for the caller; returns `{ listing }`                                  |
| DELETE | `/api/listings/:id/favorite`          | yes  | Remove a listing from the caller's saved items; returns `{ listing }`                 |
| GET    | `/api/me/favorites`                   | yes  | The caller's saved listings, most recently saved first; returns `{ listings }`        |

### Editing listings

`PATCH /api/listings/:id` changes a listing you sell. Send any of `title`,
`description` and `priceYen`; fields you leave out keep their values.

Rules:

- The new values follow the rules for a new listing: `title` is required and at
  most 80 characters, `description` at most 1000 characters (both are trimmed),
  and `priceYen` an integer from 300 to 9,999,999. A bad value fails with
  `400 invalid_title`, `invalid_description` or `invalid_price`, and then nothing
  changes, not even the fields that were valid.
- Other fields, such as `status`, `sellerId`, `buyerId`, `createdAt` or
  `updatedAt`, are ignored. A body with none of the three fields fails with
  `400 no_changes`.
- Only the seller can edit: anyone else gets `403 not_seller`. A sold listing
  fails with `409 already_sold`, and a withdrawn one with `409 listing_withdrawn`.
- `updatedAt` is `null` until the first edit, then the time of the latest edit
  (ISO 8601, UTC). `createdAt` never changes, so an edit does not move the
  listing in `GET /api/listings`, and its saves and saved count stay the same.

```bash
curl -X PATCH -H 'X-User-Id: u2' -H 'Content-Type: application/json' \
  -d '{"priceYen":3900}' http://localhost:3000/api/listings/l2
```

### Favorites

Every listing in a response carries two extra fields:

- `savedCount`: how many users saved the listing. It is public, so guests see it too.
  The API never says _who_ saved a listing.
- `savedByMe`: whether the user in `X-User-Id` saved it. `false` for guests.

Rules:

- Saving a listing you already saved succeeds and changes nothing, not even its
  position in your saved list. Removing a listing you have not saved also succeeds.
- Removing a listing and saving it again moves it to the front of your saved list.
- You cannot save your own listing: `409 own_listing`.
- You can keep at most 100 saved listings. Saving another one fails with
  `409 favorites_limit_reached` until you remove one. Sold listings count too.
- Saving or removing a listing that does not exist fails with `404 listing_not_found`.
- Sold listings can be saved and removed. A saved listing that is later sold
  stays in your saved list with `status: "sold"`.
- `/api/me/favorites` always returns the caller's own list. It takes no filters.

```bash
curl -X PUT -H 'X-User-Id: u1' http://localhost:3000/api/listings/l2/favorite
curl -H 'X-User-Id: u1' http://localhost:3000/api/me/favorites
curl -X DELETE -H 'X-User-Id: u1' http://localhost:3000/api/listings/l2/favorite
```

## Layout

```
src/server.js              process entry point
src/app.js                 HTTP layer: routes, mock auth, JSON, static files
src/listings.js            business rules for listings
src/favorites.js           business rules for saved listings (favorites)
src/store.js               in-memory data and seed
src/errors.js              AppError and helpers
src/redact.js              masks credentials and personal data before logging
src/logger.js              JSON-lines logger; every field goes through redact()
src/metrics.js             request and process metrics in the Prometheus format
src/flags.js               feature flags and FEATURE_FLAGS parsing
public/                    browser client (plain HTML/CSS/JS)
public/controller.js       client page state and ordering of loads and favorite toggles
public/favorites-state.js  pure helpers for the client's Favorites state
test/                      node:test suites (test/<topic>.test.js); helpers in test/support/
scripts/                   dev server, quality gate, repo checks, API docs, test reports, profiling
docs/api/                  OpenAPI schema and the API reference generated from it
docs/runbooks/             local debugging and release runbooks
docs/architecture.md       modules and the flow of one request
.factory/skills/           task skills for coding agents
.devcontainer/             dev container (Node.js 22, ESLint, Prettier)
.githooks/pre-commit       runs check and tests on staged files before each commit
docs/prd/                  product requirement documents
.github/                   CI and security workflows, Dependabot, CODEOWNERS, templates, labels
.zap/rules.tsv             ZAP baseline scan rule levels
```

Data, including saved listings, is kept in memory and resets when the server
restarts.
