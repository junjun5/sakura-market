---
name: quality-gate
description: Run and fix the sakura-market-mini quality gate (format, lint, types, dead code, duplicates, repository rules, docs checks, tests with coverage). Use before finishing any change, or when npm run check or CI fails.
---

# Quality gate

1. If `node_modules/` is missing, run `npm ci`.
2. Run `npm run check`. It runs every step and lists the failed ones at the end. Fix each one at its cause:
   - **format**: run `npm run format`, then review the diff.
   - **lint**: fix the code. For `complexity`, `max-depth`, `max-params` or `max-lines`, split the function or file; do not add `eslint-disable` comments.
   - **types**: add or correct JSDoc types. Prefer narrowing (`typeof`, `instanceof`) over casts.
   - **knip**: delete the unused file, export or dependency. An export used only in its own file is fine.
   - **jscpd**: extract the duplicated block into a shared helper.
   - **repository rules**: link tech debt markers to an issue (`TODO(#123): ...`), rename tests to `test/<topic>.test.js`, keep files under 256 KB.
   - **API docs**: run `npm run docs:api` after editing `docs/api/openapi.json`.
   - **AGENTS.md and README.md commands**: document new `package.json` scripts in the AGENTS.md command table, and fix paths that no longer exist.
3. Run `npm test`. For a single file: `node --test test/<topic>.test.js`.
4. On Node.js 22.8 or newer, run `npm run test:coverage` and `npm run test:report` to see the coverage gate and the slowest tests, as CI does.
5. If a test passes and fails at random, run `npm run test:flaky -- 10` and fix the test's dependence on timing or shared state.
