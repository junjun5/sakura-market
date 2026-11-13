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

Run `npm run check && npm test` before you call a task done.

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

## Boundaries

- Keep data in memory. Do not add a database.
- Do not change the behaviour of existing routes unless the task says so.
- Product requirements live in `docs/prd/`. Treat anything listed there as out of scope as out of scope.
