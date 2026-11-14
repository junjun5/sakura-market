# sakura-market-mini

A tiny C2C marketplace service: people list items, other people buy them, and
buyers can save listings to come back to later. It is a demo target for
agent-driven development, so it is small on purpose and has no dependencies
beyond Node.js.

## Run

Requires Node.js 20 or newer. There is nothing to install.

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
and variables set in the shell override it. The only setting today is `PORT`
(default `3000`). Loading `.env` needs Node.js 20.12 or newer.

## Test

```bash
npm run check                      # syntax check for every .js file in src/, public/ and test/
npm test                           # unit + API tests (node:test)
node --test test/favorites.test.js # one test file
```

Run `npm run check && npm test` before calling a change done. To have Git run
that for you, install the pre-commit hook once per clone:

```bash
scripts/install-hooks.sh   # sets core.hooksPath to .githooks
```

The hook checks the staged version of the files, so unstaged edits and
untracked files do not affect the result. Unit tests use a
fresh in-memory store; API tests start a real server on a random port. There are
no browser tests: to check the page, start the server and use it.

## CI and security

Workflows in `.github/workflows/` run on every pull request and on pushes to `main`:

- `ci.yml`: `npm run check` and `npm test` on Node.js 20. The ruleset in `.github/rulesets/protect-main.json` requires its `check-and-test` job, and a pull request, for every change to `main`.
- `security.yml`: a gitleaks secret scan of the full history, and an OWASP ZAP baseline scan of the running server. The ZAP report is uploaded as the `zap-baseline` artifact, and its rule levels are in `.zap/rules.tsv`.
- `codeql.yml`: CodeQL static analysis. Results appear under Security > Code scanning.
- `sync-labels.yml`: applies `.github/labels.yml` to the repository's labels.

Dependabot (`.github/dependabot.yml`) proposes weekly updates for the pinned
Actions, but only for releases that are at least 7 days old. Server error logs go
through `src/redact.js`, which masks credentials (including `X-User-Id`) and
email addresses.
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

All responses are JSON. Errors look like `{ "error": { "code": "...", "message": "..." } }`.
"Auth" is a mock: send `X-User-Id: u1` (Hana), `u2` (Ken) or `u3` (Mio).
Routes marked "yes" answer `401 unauthorized` without a known user.

| Method | Path | Auth | What it does |
| --- | --- | --- | --- |
| GET | `/api/health` | no | Liveness check |
| GET | `/api/users` | no | Seed users |
| GET | `/api/me` | yes | The calling user |
| GET | `/api/listings?status=on_sale&q=text` | no | List, filter by status, search by title |
| GET | `/api/listings/:id` | no | One listing |
| POST | `/api/listings` | yes | Create a listing (`title`, `description`, `priceYen`) |
| POST | `/api/listings/:id/purchase` | yes | Buy a listing |
| PUT | `/api/listings/:id/favorite` | yes | Save a listing for the caller; returns `{ listing }` |
| DELETE | `/api/listings/:id/favorite` | yes | Remove a listing from the caller's saved items; returns `{ listing }` |
| GET | `/api/me/favorites` | yes | The caller's saved listings, most recently saved first; returns `{ listings }` |

### Favorites

Every listing in a response carries two extra fields:

- `savedCount`: how many users saved the listing. It is public, so guests see it too.
  The API never says *who* saved a listing.
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
public/                    browser client (plain HTML/CSS/JS)
public/controller.js       client page state and ordering of loads and favorite toggles
public/favorites-state.js  pure helpers for the client's Favorites state
test/                      node:test suites
scripts/                   dev server control, syntax check, hook install
.githooks/pre-commit       runs check and tests on staged files before each commit
docs/prd/                  product requirement documents
.github/                   CI and security workflows, Dependabot, CODEOWNERS, templates, labels
.zap/rules.tsv             ZAP baseline scan rule levels
```

Data, including saved listings, is kept in memory and resets when the server
restarts.
