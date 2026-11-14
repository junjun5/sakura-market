import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFlags } from '../src/flags.js';
import { createLogger } from '../src/logger.js';
import { createMetrics, METRICS_CONTENT_TYPE } from '../src/metrics.js';
import { REDACTED } from '../src/redact.js';
import { withServer } from './support/server.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function captureLogger(level = 'info') {
  const lines = [];
  const logger = createLogger({ level, write: (line) => lines.push(JSON.parse(line)) });
  return { logger, lines };
}

test('every response carries an X-Request-ID, generated when the caller sends none', () =>
  withServer(async (call) => {
    const responses = [
      await call('GET', '/api/health'),
      await call('GET', '/api/listings/nope'),
      await call('GET', '/api/nope'),
      await call('GET', '/'),
      await call('GET', '/missing.txt'),
    ];
    const ids = responses.map((res) => res.headers.get('x-request-id'));
    for (const id of ids) assert.match(id, UUID);
    assert.equal(new Set(ids).size, ids.length);
  }));

test('a well-formed incoming X-Request-ID is reused', () =>
  withServer(async (call) => {
    for (const id of ['req-123', 'trace.abc:42_x', 'A'.repeat(128)]) {
      const res = await call('GET', '/api/health', { headers: { 'x-request-id': id } });
      assert.equal(res.headers.get('x-request-id'), id);
    }
  }));

test('a malformed or oversized incoming X-Request-ID is replaced', () =>
  withServer(async (call) => {
    for (const id of ['has space', 'semi;colon', '<script>', 'A'.repeat(129)]) {
      const res = await call('GET', '/api/health', { headers: { 'x-request-id': id } });
      const echoed = res.headers.get('x-request-id');
      assert.notEqual(echoed, id);
      assert.match(echoed, UUID);
    }
  }));

test('existing routes keep their status and body when request IDs are added', () =>
  withServer(async (call) => {
    const res = await call('GET', '/api/health', { headers: { 'x-request-id': 'req-1' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.match(res.headers.get('content-type'), /application\/json/);
  }));

test('each request writes one access log line with its request ID, route pattern and status', async () => {
  const { logger, lines } = captureLogger();
  await withServer(
    async (call) => {
      await call('GET', '/api/listings/l2', { userId: 'u1', headers: { 'x-request-id': 'req-detail' } });
      await call('PUT', '/api/listings/nope/favorite', {
        userId: 'u1',
        headers: { 'x-request-id': 'req-404' },
      });
      await call('GET', '/api/nope', { headers: { 'x-request-id': 'req-unmatched' } });
      await call('GET', '/style.css', { headers: { 'x-request-id': 'req-static' } });
    },
    { logger },
  );

  const summary = lines.map(({ level, msg, requestId, method, path, route, status }) => ({
    level,
    msg,
    requestId,
    method,
    path,
    route,
    status,
  }));
  assert.deepEqual(summary, [
    {
      level: 'info',
      msg: 'request',
      requestId: 'req-detail',
      method: 'GET',
      path: '/api/listings/l2',
      route: '/api/listings/:id',
      status: 200,
    },
    {
      level: 'info',
      msg: 'request',
      requestId: 'req-404',
      method: 'PUT',
      path: '/api/listings/nope/favorite',
      route: '/api/listings/:id/favorite',
      status: 404,
    },
    {
      level: 'info',
      msg: 'request',
      requestId: 'req-unmatched',
      method: 'GET',
      path: '/api/nope',
      route: 'unmatched',
      status: 404,
    },
    {
      level: 'info',
      msg: 'request',
      requestId: 'req-static',
      method: 'GET',
      path: '/style.css',
      route: 'static',
      status: 200,
    },
  ]);
  for (const line of lines) {
    assert.equal(typeof line.durationMs, 'number');
    assert.ok(line.durationMs >= 0);
    assert.ok(!Number.isNaN(Date.parse(line.time)));
  }
  // Access logs never carry the mock credential.
  assert.doesNotMatch(JSON.stringify(lines), /"u1"/);
});

test('access logs are info level, so LOG_LEVEL=warn leaves only problems in the log', async () => {
  const { logger, lines } = captureLogger('warn');
  await withServer(
    async (call) => {
      assert.equal((await call('GET', '/api/health')).status, 200);
      assert.equal((await call('GET', '/api/nope')).status, 404);
    },
    { logger },
  );
  assert.deepEqual(lines, []);
});

test('an injected metrics registry sees the same requests the app answers', async () => {
  const metrics = createMetrics();
  await withServer(
    async (call) => {
      await call('GET', '/api/me', { userId: 'u1' });
      await call('GET', '/api/me');
    },
    { metrics, flags: createFlags('metrics_endpoint=off') },
  );
  const text = metrics.render();
  assert.match(text, /^http_requests_total\{method="GET",route="\/api\/me",status="200"\} 1$/m);
  assert.match(text, /^http_requests_total\{method="GET",route="\/api\/me",status="401"\} 1$/m);
  assert.ok(!text.includes(REDACTED));
});

test('GET /api/metrics reports requests by route pattern in the Prometheus format', () =>
  withServer(async (call) => {
    await call('GET', '/api/listings/l1');
    await call('GET', '/api/listings/l2');
    await call('GET', '/api/listings/nope');
    await call('POST', '/api/listings', { body: { title: 'Lamp', priceYen: 1000 } });
    // A method Node accepts but the app has no list entry for.
    await call('PROPFIND', '/api/coffee');

    const res = await call('GET', '/api/metrics');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), METRICS_CONTENT_TYPE);
    assert.match(res.headers.get('x-request-id'), UUID);
    const text = res.body;
    assert.match(text, /^http_requests_total\{method="GET",route="\/api\/listings\/:id",status="200"\} 2$/m);
    assert.match(text, /^http_requests_total\{method="GET",route="\/api\/listings\/:id",status="404"\} 1$/m);
    assert.match(text, /^http_requests_total\{method="POST",route="\/api\/listings",status="401"\} 1$/m);
    assert.match(text, /^http_requests_total\{method="OTHER",route="unmatched",status="404"\} 1$/m);
    assert.match(
      text,
      /^http_request_duration_seconds_count\{method="GET",route="\/api\/listings\/:id"\} 3$/m,
    );
    // Raw paths and IDs never become labels.
    assert.doesNotMatch(text, /l1|l2|nope|coffee|PROPFIND/);
  }));

test('GET /api/metrics counts itself on the next scrape', () =>
  withServer(async (call) => {
    const first = await call('GET', '/api/metrics');
    assert.doesNotMatch(first.body, /route="\/api\/metrics"/);
    const second = await call('GET', '/api/metrics');
    assert.match(second.body, /^http_requests_total\{method="GET",route="\/api\/metrics",status="200"\} 1$/m);
  }));

test('turning the metrics_endpoint flag off removes GET /api/metrics', () =>
  withServer(
    async (call) => {
      const res = await call('GET', '/api/metrics');
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'route_not_found');
      assert.equal((await call('GET', '/api/health')).status, 200);
    },
    { flags: createFlags('metrics_endpoint=off') },
  ));
