# Debugging a request

Use this when one request failed with a 500, or answered something unexpected.

## 1. Get the request ID

Every response carries `X-Request-ID`. From the command line:

```bash
curl -si -H 'X-User-Id: u1' http://localhost:3000/api/me/favorites | grep -i x-request-id
```

In the browser, open DevTools > Network, select the request and read the
`X-Request-ID` response header. To reproduce with a known ID, send your own:
`-H 'X-Request-ID: debug-123'` (letters, digits and `._:-`, up to 128
characters; anything else is replaced with a generated ID).

## 2. Find its log lines

```bash
scripts/dev.sh logs 1000 | grep '"requestId":"debug-123"'
```

With `jq` installed, filter and pretty-print instead:

```bash
scripts/dev.sh logs 1000 | jq -c 'select(.requestId == "debug-123")'
```

Each request writes one `request` line with `method`, `path`, `route` (the
matched pattern, such as `/api/listings/:id`), `status` and `durationMs`. A 500
also writes an `unhandled_error` line at `error` level with the redacted
headers and the error with its stack and cause.

## 3. Read the error

- `4xx` responses are expected errors: the body is `{ error: { code, message } }`
  and every `code` is listed in `docs/api/openapi.json` (`x-error-codes`). Find
  where it is thrown with `grep -rn "'<code>'" src/`.
- `500` means an exception escaped a route. The `unhandled_error` line has the
  stack. Reproduce it in a test first: API tests in `test/api.test.js` use
  `withServer` from `test/support/server.js` and can pass a `logger` that records
  lines, as `test/observability.test.js` does.

## 4. Check the fix

Run `npm run check && npm test`, then repeat the request from step 1 against a
restarted server (`scripts/dev.sh stop && scripts/dev.sh start`) and confirm the
new log line has the expected status.

## Dead ends

- No log line at all: the request did not reach this server. Check the port
  (`scripts/dev.sh status`) and that nothing else listens on it.
- Only `request` lines with `"route":"unmatched"`: the method or path does not
  match any route. Compare with the route table in `docs/api/README.md`.
