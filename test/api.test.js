import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { createApp } from '../src/app.js';

// Starts a fresh server (fresh in-memory store) on a random port for one test.
async function withServer(run) {
  const server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, { userId, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(userId ? { 'x-user-id': userId } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    const isJson = res.headers.get('content-type')?.includes('application/json');
    return { status: res.status, body: isJson ? JSON.parse(text) : text, headers: res.headers };
  };

  try {
    await run(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/health', () =>
  withServer(async (call) => {
    const res = await call('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  }));

test('GET /api/me needs a known user', () =>
  withServer(async (call) => {
    assert.equal((await call('GET', '/api/me')).status, 401);
    assert.equal((await call('GET', '/api/me', { userId: 'ghost' })).status, 401);
    const res = await call('GET', '/api/me', { userId: 'u2' });
    assert.deepEqual(res.body, { user: { id: 'u2', name: 'Ken' } });
  }));

test('GET /api/listings lists, filters and searches', () =>
  withServer(async (call) => {
    const all = await call('GET', '/api/listings');
    assert.equal(all.status, 200);
    assert.equal(all.body.listings.length, 5);

    const onSale = await call('GET', '/api/listings?status=on_sale');
    assert.ok(onSale.body.listings.every((l) => l.status === 'on_sale'));
    assert.equal(onSale.body.listings.length, 4);

    const search = await call('GET', '/api/listings?q=helmet');
    assert.deepEqual(
      search.body.listings.map((l) => l.id),
      ['l2'],
    );

    const bad = await call('GET', '/api/listings?status=archived');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'invalid_status');
  }));

test('GET /api/listings/:id', () =>
  withServer(async (call) => {
    const found = await call('GET', '/api/listings/l1');
    assert.equal(found.body.listing.title, 'Film camera, 35mm');

    const missing = await call('GET', '/api/listings/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'listing_not_found');
  }));

test('POST /api/listings creates a listing for the caller', () =>
  withServer(async (call) => {
    const input = { title: 'Desk lamp', description: 'LED', priceYen: 2000 };

    assert.equal((await call('POST', '/api/listings', { body: input })).status, 401);

    const created = await call('POST', '/api/listings', { userId: 'u1', body: input });
    assert.equal(created.status, 201);
    assert.equal(created.body.listing.sellerId, 'u1');
    assert.equal(created.body.listing.status, 'on_sale');

    const fetched = await call('GET', `/api/listings/${created.body.listing.id}`);
    assert.equal(fetched.body.listing.title, 'Desk lamp');

    const invalid = await call('POST', '/api/listings', { userId: 'u1', body: { title: 'Lamp', priceYen: 1 } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'invalid_price');

    const notJson = await call('POST', '/api/listings', { userId: 'u1', body: '{oops' });
    assert.equal(notJson.status, 400);
    assert.equal(notJson.body.error.code, 'invalid_json');
  }));

test('POST /api/listings/:id/purchase', () =>
  withServer(async (call) => {
    assert.equal((await call('POST', '/api/listings/l2/purchase')).status, 401);

    const own = await call('POST', '/api/listings/l2/purchase', { userId: 'u2' });
    assert.equal(own.status, 409);
    assert.equal(own.body.error.code, 'own_listing');

    const bought = await call('POST', '/api/listings/l2/purchase', { userId: 'u1' });
    assert.equal(bought.status, 200);
    assert.equal(bought.body.listing.status, 'sold');
    assert.equal(bought.body.listing.buyerId, 'u1');

    const again = await call('POST', '/api/listings/l2/purchase', { userId: 'u3' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'already_sold');
  }));

test('unknown API routes return a JSON 404', () =>
  withServer(async (call) => {
    const res = await call('GET', '/api/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'route_not_found');
  }));

test('static files are served and path traversal is blocked', () =>
  withServer(async (call) => {
    const index = await call('GET', '/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(index.body, /Sakura Market/);

    assert.equal((await call('GET', '/app.js')).status, 200);
    assert.equal((await call('GET', '/missing.txt')).status, 404);
    assert.equal((await call('GET', '/..%2fpackage.json')).status, 404);
  }));
