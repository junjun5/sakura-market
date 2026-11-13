# sakura-market-mini

A tiny C2C marketplace service: people list items, other people buy them.
It is a demo target for agent-driven development, so it is small on purpose
and has no dependencies beyond Node.js.

## Run

```bash
npm test                 # unit + API tests (node:test)
npm run check            # syntax check for every .js file
scripts/dev.sh start     # background server on http://localhost:3000
scripts/dev.sh logs      # last 50 log lines
scripts/dev.sh stop
```

Requires Node.js 20 or newer. There is nothing to install.

## API

All responses are JSON. Errors look like `{ "error": { "code": "...", "message": "..." } }`.
"Auth" is a mock: send `X-User-Id: u1` (Hana), `u2` (Ken) or `u3` (Mio).

| Method | Path | Auth | What it does |
| --- | --- | --- | --- |
| GET | `/api/health` | no | Liveness check |
| GET | `/api/users` | no | Seed users |
| GET | `/api/me` | yes | The calling user |
| GET | `/api/listings?status=on_sale&q=text` | no | List, filter by status, search by title |
| GET | `/api/listings/:id` | no | One listing |
| POST | `/api/listings` | yes | Create a listing (`title`, `description`, `priceYen`) |
| POST | `/api/listings/:id/purchase` | yes | Buy a listing |

## Layout

```
src/server.js     process entry point
src/app.js        HTTP layer: routes, mock auth, JSON, static files
src/listings.js   business rules for listings
src/store.js      in-memory data and seed
src/errors.js     AppError and helpers
public/           browser client (plain HTML/CSS/JS)
test/             node:test suites
docs/prd/         product requirement documents
```

Data is kept in memory and resets when the server restarts.
