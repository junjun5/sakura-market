# Performance and metrics

Use this when the server is slow, its memory grows, or a route starts failing
more often.

## 1. Read the metrics

```bash
curl -s http://localhost:3000/api/metrics
```

| Metric                                         | Meaning                                                |
| ---------------------------------------------- | ------------------------------------------------------ |
| `http_requests_total{method,route,status}`     | Requests answered, by matched route pattern and status |
| `http_request_duration_seconds_bucket{le,...}` | Latency histogram per method and route                 |
| `process_uptime_seconds`                       | Seconds since the server started                       |
| `process_resident_memory_bytes`                | Resident memory of the process                         |
| `nodejs_heap_used_bytes`                       | V8 heap in use                                         |

Scrape twice a minute apart and compare: a growing `status="500"` count points
to [Debugging a request](debugging-a-request.md); a growing heap with a steady
request rate points to a leak in `src/store.js` data or a cache.

## 2. Find the slow route

The access log has `durationMs` per request:

```bash
scripts/dev.sh logs 2000 | jq -r 'select(.msg == "request") | [.durationMs, .method, .route] | @tsv' | sort -rn | head
```

## 3. Profile it

```bash
npm run profile                                   # 2000 requests, 20 at a time
npm run profile -- --requests=10000 --concurrency=50
```

The script starts its own server with `--cpu-prof`, prints p50/p95/max latency
per route, and writes a `.cpuprofile` file to `.dev/profiles/`. Open it in
Chrome DevTools (Performance > Load profile) or https://www.speedscope.app and
look for the widest frames under the route's handler.

## 4. Check the fix

Run `npm run profile` again with the same options and compare the percentiles.
Keep `npm test` fast: CI warns about tests slower than 2 s
(`npm run test:report`).
