# Runbooks

Step-by-step guides for finding out what the server is doing. The service runs
locally only (there is no deployed environment), so every runbook starts from
`scripts/dev.sh start` or `npm start`.

| Symptom                                                   | Runbook                                               |
| --------------------------------------------------------- | ----------------------------------------------------- |
| A request failed or returned the wrong answer             | [Debugging a request](debugging-a-request.md)         |
| The server is slow, uses too much memory, or errors spike | [Performance and metrics](performance-and-metrics.md) |
| Cutting a release, or undoing a bad one                   | [Releases](releases.md)                               |

## What the server gives you

- **Logs**: one JSON object per line on stdout (`info`, `debug`) and stderr
  (`warn`, `error`). `scripts/dev.sh logs 200` shows the last 200 lines of the
  background server. Set `LOG_LEVEL=debug` for more, `LOG_LEVEL=warn` for less.
  All fields are redacted, so logs are safe to paste into an issue.
- **Request IDs**: every response has an `X-Request-ID` header, and the access
  log line of that request has the same `requestId`. Send your own ID to tag a
  request: `curl -H 'X-Request-ID: debug-123' ...`.
- **Metrics**: `GET /api/metrics` in the Prometheus text format: request counts
  and latency by route and status, uptime and memory. Turned off with
  `FEATURE_FLAGS=metrics_endpoint=off`.
- **Health**: `GET /api/health` answers `{ "ok": true }` while the server runs.
- **Profiles**: `npm run profile` writes a CPU profile to `.dev/profiles/`.
