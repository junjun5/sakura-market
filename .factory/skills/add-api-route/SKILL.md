---
name: add-api-route
description: Add or change an HTTP route in sakura-market-mini, with the business rule, tests, OpenAPI schema and generated docs. Use when a task adds an endpoint or changes what an existing one accepts or returns.
---

# Add an API route

1. **Read the requirement.** If it comes from `docs/prd/`, respect its out-of-scope list. Do not change an existing route's behaviour unless the task says so.
2. **Business rule first.** Put the rule in the domain service (`src/listings.js`, `src/favorites.js`, or a new `src/<domain>.js` shaped as `createXService(store, options)`). Take plain values, throw helpers from `src/errors.js` with a snake_case `code`, and export limits as constants.
3. **Unit test it** in `test/<domain>.test.js` with a fresh `createStore()`, including every error.
4. **Wire the route** in the `routes` table in `src/app.js`: `[method, '/api/path/:param', handler]`. Use `requireUser(req)` for routes that need a user and `optionalUser(req)` for public ones.
5. **API test** in `test/api.test.js` with `withServer` from `test/support/server.js`: the success case and every error status and code.
6. **Schema**: add the operation to `docs/api/openapi.json` (parameters, request body, responses with `x-error-codes`). Then run `npm run docs:api` to regenerate `docs/api/README.md`. `test/openapi.test.js` checks the app against the schema.
7. **Docs**: update the API table in `README.md` if the route is user-facing.
8. **Gate**: `npm run check && npm test`. Then start the server with `scripts/dev.sh start`, call the route with `curl`, check `scripts/dev.sh logs` for its `request` line, and `scripts/dev.sh stop`.
