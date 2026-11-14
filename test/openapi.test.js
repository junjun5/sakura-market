import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createApp } from '../src/app.js';
import { createFlags } from '../src/flags.js';
import { createLogger } from '../src/logger.js';
import { createStore } from '../src/store.js';
import { resolve, validate } from './support/json-schema.js';
import { withServer } from './support/server.js';

const spec = JSON.parse(readFileSync(new URL('../docs/api/openapi.json', import.meta.url), 'utf8'));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const toOpenApiPath = (pattern) => pattern.replace(/:(\w+)/g, '{$1}');
const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  METHODS.filter((m) => item[m]).map((m) => ({ method: m.toUpperCase(), path, operation: item[m] })),
);
const findOperation = (method, path) => operations.find((o) => o.method === method && o.path === path);
// "METHOD path status code" for every error a contract test has seen; see the last test.
const seenErrors = new Set();

// Checks one real response against the operation it belongs to.
function assertMatchesSpec(method, path, res) {
  const entry = findOperation(method, path);
  assert.ok(entry, `${method} ${path} is not in openapi.json`);
  const response = entry.operation.responses[String(res.status)];
  assert.ok(response, `${method} ${path} answered ${res.status}, which openapi.json does not document`);
  assert.ok(res.headers.get('x-request-id'), `${method} ${path}: no X-Request-ID header`);

  const [mediaType, { schema }] = Object.entries(response.content)[0];
  assert.ok(res.headers.get('content-type').startsWith(mediaType), `${method} ${path}: content type`);
  assert.deepEqual(validate(spec, schema, res.body), [], `${method} ${path} ${res.status}`);
  if (res.status >= 400) {
    assert.ok(
      response['x-error-codes'].includes(res.body.error.code),
      `${method} ${path} ${res.status}: code ${res.body.error.code} is not in x-error-codes`,
    );
    seenErrors.add(`${method} ${path} ${res.status} ${res.body.error.code}`);
  }
}

test('openapi.json documents exactly the routes the app serves', () => {
  const served = createApp()
    .routes.map((r) => `${r.method} ${toOpenApiPath(r.path)}`)
    .sort();
  const documented = operations.map((o) => `${o.method} ${o.path}`).sort();
  assert.deepEqual(documented, served);
});

test('openapi.json is well-formed: unique operation IDs, resolvable refs, documented errors', () => {
  assert.equal(spec.openapi, '3.1.0');
  const ids = operations.map((o) => o.operation.operationId);
  assert.equal(new Set(ids).size, ids.length);

  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      if (node.$ref) resolve(spec, node);
      Object.values(node).forEach(walk);
    }
  };
  walk(spec);

  for (const { method, path, operation } of operations) {
    assert.ok(operation.summary, `${method} ${path}: summary`);
    for (const [status, response] of Object.entries(operation.responses)) {
      assert.ok(response.headers?.['X-Request-ID'], `${method} ${path} ${status}: X-Request-ID header`);
      if (Number(status) >= 400) assert.ok(response['x-error-codes']?.length, `${method} ${path} ${status}`);
    }
    if (operation.security) {
      assert.ok(operation.responses['401'], `${method} ${path}: authenticated routes document 401`);
    }
  }
});

test('the schema validator catches the mismatches the contract tests rely on', () => {
  const listing = resolve(spec, { $ref: '#/components/schemas/Listing' });
  const good = {
    id: 'l1',
    title: 'Lamp',
    description: '',
    priceYen: 1000,
    sellerId: 'u1',
    status: 'on_sale',
    buyerId: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    savedCount: 0,
    savedByMe: false,
  };
  assert.deepEqual(validate(spec, listing, good), []);
  assert.deepEqual(validate(spec, listing, { ...good, extra: 1 }), ['$.extra: not in the schema']);
  assert.deepEqual(validate(spec, listing, { ...good, status: 'archived' }), [
    '$.status: expected one of on_sale, sold',
  ]);
  const { savedCount, ...withoutCount } = good;
  assert.equal(savedCount, 0);
  assert.deepEqual(validate(spec, listing, withoutCount), ['$.savedCount: missing']);
  assert.deepEqual(validate(spec, listing, { ...good, priceYen: 1.5, buyerId: 3 }), [
    '$.priceYen: expected integer',
    '$.buyerId: expected string or null',
  ]);
});

test('read routes answer what openapi.json documents', () =>
  withServer(async (call) => {
    assertMatchesSpec('GET', '/api/health', await call('GET', '/api/health'));
    assertMatchesSpec('GET', '/api/metrics', await call('GET', '/api/metrics'));
    assertMatchesSpec('GET', '/api/users', await call('GET', '/api/users'));
    assertMatchesSpec('GET', '/api/me', await call('GET', '/api/me', { userId: 'u1' }));
    assertMatchesSpec('GET', '/api/me', await call('GET', '/api/me'));
    assertMatchesSpec('GET', '/api/me/favorites', await call('GET', '/api/me/favorites', { userId: 'u1' }));
    assertMatchesSpec(
      'GET',
      '/api/me/favorites',
      await call('GET', '/api/me/favorites', { userId: 'ghost' }),
    );
    assertMatchesSpec('GET', '/api/listings', await call('GET', '/api/listings?status=sold&q=stove'));
    assertMatchesSpec('GET', '/api/listings', await call('GET', '/api/listings?status=archived'));
    assertMatchesSpec('GET', '/api/listings/{id}', await call('GET', '/api/listings/l1', { userId: 'u2' }));
    assertMatchesSpec('GET', '/api/listings/{id}', await call('GET', '/api/listings/nope'));
  }));

test('write routes answer what openapi.json documents, including every error code', () =>
  withServer(async (call) => {
    const post = (body, userId = 'u1') => call('POST', '/api/listings', { userId, body });
    for (const res of [
      await post({ title: 'Lamp', description: 'LED', priceYen: 2000 }),
      await post({ title: ' ', priceYen: 2000 }),
      await post({ title: 'Lamp', description: 'x'.repeat(1001), priceYen: 2000 }),
      await post({ title: 'Lamp', priceYen: 1 }),
      await post('{oops'),
      await post(JSON.stringify({ title: 'x'.repeat(70 * 1024) })),
      await post({ title: 'Lamp', priceYen: 2000 }, null),
    ]) {
      assertMatchesSpec('POST', '/api/listings', res);
    }

    const buy = (id, userId) => call('POST', `/api/listings/${id}/purchase`, { userId });
    for (const res of [
      await buy('l2', 'u1'),
      await buy('l2', 'u3'),
      await buy('l3', 'u2'),
      await buy('nope', 'u1'),
      await buy('l3'),
    ]) {
      assertMatchesSpec('POST', '/api/listings/{id}/purchase', res);
    }

    const save = (id, userId) => call('PUT', `/api/listings/${id}/favorite`, { userId });
    for (const res of [
      await save('l1', 'u2'),
      await save('l1', 'u1'),
      await save('nope', 'u2'),
      await save('l1'),
    ]) {
      assertMatchesSpec('PUT', '/api/listings/{id}/favorite', res);
    }

    const remove = (id, userId) => call('DELETE', `/api/listings/${id}/favorite`, { userId });
    for (const res of [await remove('l1', 'u2'), await remove('nope', 'u2'), await remove('l1')]) {
      assertMatchesSpec('DELETE', '/api/listings/{id}/favorite', res);
    }
  }));

test('the favorites limit error matches openapi.json', () => {
  const listings = Array.from({ length: 101 }, (_, i) => ({
    id: `b${i + 1}`,
    title: `Item ${i + 1}`,
    description: '',
    priceYen: 1000,
    sellerId: 'u2',
    status: 'on_sale',
    buyerId: null,
    createdAt: '2026-04-01T09:00:00.000Z',
  }));
  return withServer(
    async (call) => {
      for (let i = 1; i <= 100; i += 1) await call('PUT', `/api/listings/b${i}/favorite`, { userId: 'u1' });
      const res = await call('PUT', '/api/listings/b101/favorite', { userId: 'u1' });
      assert.equal(res.body.error.code, 'favorites_limit_reached');
      assertMatchesSpec('PUT', '/api/listings/{id}/favorite', res);
    },
    { store: createStore({ listings }) },
  );
});

test('unexpected errors match the documented 500 response', () => {
  const store = createStore();
  store.listUsers = () => {
    throw new Error('boom');
  };
  return withServer(async (call) => assertMatchesSpec('GET', '/api/users', await call('GET', '/api/users')), {
    store,
    logger: createLogger({ level: 'silent' }),
  });
});

test('with metrics_endpoint off, the documented metrics route is gone', () => {
  const served = createApp({ flags: createFlags('metrics_endpoint=off') }).routes.map((r) => r.path);
  assert.ok(!served.includes('/api/metrics'));
  assert.ok(findOperation('GET', '/api/metrics').operation.description.includes('metrics_endpoint=off'));
});

// Runs last (node:test runs a file's top-level tests in order). The 500 response
// is shared by every operation, so one exercised instance is enough for it.
test('every documented error code is exercised by a contract test above', () => {
  const documented = operations.flatMap(({ method, path, operation }) =>
    Object.entries(operation.responses)
      .filter(([status]) => Number(status) >= 400 && status !== '500')
      .flatMap(([status, response]) =>
        response['x-error-codes'].map((code) => `${method} ${path} ${status} ${code}`),
      ),
  );
  assert.deepEqual(
    documented.filter((key) => !seenErrors.has(key)),
    [],
  );
  assert.ok([...seenErrors].some((key) => key.endsWith(' 500 internal')));
});
