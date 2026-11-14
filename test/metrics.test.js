import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMetrics, DURATION_BUCKETS_SECONDS, METRICS_CONTENT_TYPE } from '../src/metrics.js';

function fixedMetrics() {
  return createMetrics({
    startedAt: 1_000,
    now: () => 61_000,
    memoryUsage: () => ({ rss: 50, heapUsed: 20, heapTotal: 30, external: 0, arrayBuffers: 0 }),
  });
}

const sample = (text, series) => {
  const line = text.split('\n').find((l) => l.startsWith(`${series} `));
  return line === undefined ? undefined : Number(line.slice(series.length + 1));
};

test('metrics use the Prometheus text format content type', () => {
  assert.equal(METRICS_CONTENT_TYPE, 'text/plain; version=0.0.4; charset=utf-8');
});

test('metrics count requests by method, route pattern and status', () => {
  const metrics = fixedMetrics();
  metrics.observeRequest({ method: 'GET', route: '/api/listings/:id', status: 200, durationMs: 3 });
  metrics.observeRequest({ method: 'GET', route: '/api/listings/:id', status: 200, durationMs: 4 });
  metrics.observeRequest({ method: 'GET', route: '/api/listings/:id', status: 404, durationMs: 1 });
  const text = metrics.render();

  assert.match(text, /^# TYPE http_requests_total counter$/m);
  assert.equal(sample(text, 'http_requests_total{method="GET",route="/api/listings/:id",status="200"}'), 2);
  assert.equal(sample(text, 'http_requests_total{method="GET",route="/api/listings/:id",status="404"}'), 1);
});

test('metrics put durations into cumulative histogram buckets', () => {
  const metrics = fixedMetrics();
  for (const durationMs of [2, 30, 30, 7000]) {
    metrics.observeRequest({ method: 'POST', route: '/api/listings', status: 201, durationMs });
  }
  const text = metrics.render();
  const labels = 'method="POST",route="/api/listings"';
  const bucket = (le) => sample(text, `http_request_duration_seconds_bucket{${labels},le="${le}"}`);

  assert.match(text, /^# TYPE http_request_duration_seconds histogram$/m);
  assert.equal(bucket('0.005'), 1);
  assert.equal(bucket('0.025'), 1);
  assert.equal(bucket('0.05'), 3);
  assert.equal(bucket(String(DURATION_BUCKETS_SECONDS.at(-1))), 3);
  assert.equal(bucket('+Inf'), 4);
  assert.equal(sample(text, `http_request_duration_seconds_count{${labels}}`), 4);
  assert.ok(Math.abs(sample(text, `http_request_duration_seconds_sum{${labels}}`) - 7.062) < 1e-9);
});

test('metrics fold unknown methods into OTHER and escape label values', () => {
  const metrics = fixedMetrics();
  metrics.observeRequest({ method: 'BREW', route: 'unmatched', status: 404, durationMs: 1 });
  metrics.observeRequest({ method: undefined, route: 'a"b\\c\nd', status: 404, durationMs: 1 });
  const text = metrics.render();
  assert.equal(sample(text, 'http_requests_total{method="OTHER",route="unmatched",status="404"}'), 1);
  assert.equal(sample(text, 'http_requests_total{method="OTHER",route="a\\"b\\\\c\\nd",status="404"}'), 1);
  assert.doesNotMatch(text, /BREW/);
});

test('metrics report uptime and memory gauges', () => {
  const text = fixedMetrics().render();
  assert.equal(sample(text, 'process_uptime_seconds'), 60);
  assert.equal(sample(text, 'process_resident_memory_bytes'), 50);
  assert.equal(sample(text, 'nodejs_heap_used_bytes'), 20);
  assert.ok(text.endsWith('\n'));
});
