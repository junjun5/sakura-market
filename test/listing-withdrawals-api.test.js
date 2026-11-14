import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createStore } from '../src/store.js';
import { assertError, LISTING_KEYS } from './support/api.js';
import { withServer } from './support/server.js';

const HELMET = 'l2'; // Ken's
const KEYBOARD = 'l3'; // Ken's
const STOVE = 'l4'; // Mio's, already sold
const WITHDRAWN_MESSAGE = 'This listing has been withdrawn.';

const withdraw = (call, id, userId = 'u2') => call('POST', `/api/listings/${id}/withdraw`, { userId });
const getListing = async (call, id, userId) =>
  (await call('GET', `/api/listings/${id}`, { userId })).body.listing;
const listIds = async (call, query = '', userId = undefined) =>
  (await call('GET', `/api/listings${query}`, { userId })).body.listings.map((l) => l.id);
const savedIds = async (call, userId) =>
  (await call('GET', '/api/me/favorites', { userId })).body.listings.map((l) => l.id);
const save = (call, id, userId) => call('PUT', `/api/listings/${id}/favorite`, { userId });
const unsave = (call, id, userId) => call('DELETE', `/api/listings/${id}/favorite`, { userId });

function assertErrorMessage(res, status, code, message) {
  assertError(res, status, code);
  assert.equal(res.body.error.message, message);
}

test('POST /api/listings/:id/withdraw withdraws the seller listing', () =>
  withServer(async (call) => {
    const before = await getListing(call, KEYBOARD);
    const res = await withdraw(call, KEYBOARD);
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body), ['listing']);
    assert.deepEqual(Object.keys(res.body.listing).sort(), LISTING_KEYS);
    assert.deepEqual(res.body.listing, { ...before, status: 'withdrawn' });
    assert.equal(res.body.listing.updatedAt, null);

    const again = await withdraw(call, KEYBOARD);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body.listing, res.body.listing);
    assert.ok(!(await listIds(call)).includes(KEYBOARD));
  }));

test('POST /api/listings/:id/withdraw checks the user, the listing, the seller and the status', () =>
  withServer(async (call) => {
    for (const userId of [null, 'u999']) {
      assertError(await withdraw(call, HELMET, userId), 401, 'unauthorized');
    }
    assertError(await withdraw(call, 'l999', null), 401, 'unauthorized');
    assertErrorMessage(
      await withdraw(call, 'l999'),
      404,
      'listing_not_found',
      'Listing l999 does not exist.',
    );
    assertErrorMessage(
      await withdraw(call, HELMET, 'u1'),
      403,
      'not_seller',
      'Only the seller can change this listing.',
    );
    assert.equal((await getListing(call, HELMET)).status, 'on_sale');

    assertErrorMessage(
      await withdraw(call, STOVE, 'u3'),
      409,
      'already_sold',
      'This listing has already been sold.',
    );
    const stove = await getListing(call, STOVE);
    assert.deepEqual([stove.status, stove.buyerId], ['sold', 'u1']);

    assert.equal((await withdraw(call, KEYBOARD)).status, 200);
    assertError(await withdraw(call, KEYBOARD, 'u1'), 403, 'not_seller');
  }));

test('a withdrawn listing is hidden from the list, search and filters for everyone', () =>
  withServer(async (call) => {
    await withdraw(call, KEYBOARD);
    for (const userId of [undefined, 'u1', 'u2', 'u3']) {
      assert.deepEqual(await listIds(call, '', userId), ['l5', 'l4', 'l2', 'l1']);
      assert.deepEqual(await listIds(call, '?status=on_sale', userId), ['l5', 'l2', 'l1']);
      assert.deepEqual(await listIds(call, '?status=sold', userId), ['l4']);
      assert.deepEqual(await listIds(call, '?status=on_sale&q=keyboard', userId), []);
      assert.deepEqual(await listIds(call, '?q=keyboard', userId), []);
      assert.deepEqual(await listIds(call, '?q=Mechanical', userId), []);
      assert.deepEqual(await listIds(call, '?q=helmet', userId), [HELMET]);
    }
    for (const status of ['withdrawn', 'bogus']) {
      assertErrorMessage(
        await call('GET', `/api/listings?status=${status}`),
        400,
        'invalid_status',
        'status must be one of: on_sale, sold.',
      );
    }
  }));

test('a withdrawn listing can still be opened by its ID', () =>
  withServer(async (call) => {
    await withdraw(call, KEYBOARD);
    for (const userId of [undefined, 'u1', 'u2']) {
      const res = await call('GET', `/api/listings/${KEYBOARD}`, { userId });
      assert.equal(res.status, 200);
      const { listing } = res.body;
      assert.deepEqual(
        [listing.status, listing.buyerId, listing.title, listing.priceYen],
        ['withdrawn', null, 'Mechanical keyboard', 7800],
      );
    }
  }));

test('a withdrawn listing cannot be bought or edited', () =>
  withServer(async (call) => {
    await withdraw(call, KEYBOARD);
    for (const userId of ['u3', 'u1']) {
      assertErrorMessage(
        await call('POST', `/api/listings/${KEYBOARD}/purchase`, { userId }),
        409,
        'listing_withdrawn',
        WITHDRAWN_MESSAGE,
      );
    }
    assertError(
      await call('POST', `/api/listings/${KEYBOARD}/purchase`, { userId: 'u2' }),
      409,
      'own_listing',
    );
    for (const body of [{ priceYen: 7000 }, {}]) {
      assertErrorMessage(
        await call('PATCH', `/api/listings/${KEYBOARD}`, { userId: 'u2', body }),
        409,
        'listing_withdrawn',
        WITHDRAWN_MESSAGE,
      );
    }
    const keyboard = await getListing(call, KEYBOARD);
    assert.deepEqual(
      [keyboard.priceYen, keyboard.status, keyboard.buyerId, keyboard.updatedAt],
      [7800, 'withdrawn', null, null],
    );
  }));

test('a withdrawn listing cannot be newly saved', () =>
  withServer(async (call) => {
    await save(call, KEYBOARD, 'u1');
    await withdraw(call, KEYBOARD);
    assertErrorMessage(await save(call, KEYBOARD, 'u3'), 409, 'listing_withdrawn', WITHDRAWN_MESSAGE);
    assert.equal((await getListing(call, KEYBOARD)).savedCount, 1);
    assert.deepEqual(await savedIds(call, 'u3'), []);
    assertError(await save(call, KEYBOARD, 'u2'), 409, 'own_listing');
  }));

test('a saved listing that is withdrawn stays in Saved with its count and can be removed', () =>
  withServer(async (call) => {
    for (const id of [KEYBOARD, 'l5', HELMET]) await save(call, id, 'u1');
    await save(call, KEYBOARD, 'u3');
    assert.deepEqual(await savedIds(call, 'u1'), [HELMET, 'l5', KEYBOARD]);

    const res = await withdraw(call, KEYBOARD);
    assert.equal(res.body.listing.savedCount, 2);
    const saved = (await call('GET', '/api/me/favorites', { userId: 'u1' })).body.listings;
    assert.deepEqual(
      saved.map((l) => l.id),
      [HELMET, 'l5', KEYBOARD],
    );
    assert.deepEqual([saved[2].status, saved[2].savedByMe, saved[2].savedCount], ['withdrawn', true, 2]);
    assert.equal((await getListing(call, KEYBOARD)).savedCount, 2);

    const again = await save(call, KEYBOARD, 'u1');
    assert.equal(again.status, 200);
    assert.deepEqual([again.body.listing.savedByMe, again.body.listing.savedCount], [true, 2]);
    assert.deepEqual(await savedIds(call, 'u1'), [HELMET, 'l5', KEYBOARD]);

    const removed = await unsave(call, KEYBOARD, 'u1');
    assert.equal(removed.status, 200);
    assert.deepEqual(
      [removed.body.listing.status, removed.body.listing.savedByMe, removed.body.listing.savedCount],
      ['withdrawn', false, 1],
    );
    assert.deepEqual(await savedIds(call, 'u1'), [HELMET, 'l5']);
    assert.deepEqual(await savedIds(call, 'u3'), [KEYBOARD]);

    assertError(await save(call, KEYBOARD, 'u1'), 409, 'listing_withdrawn');
    assert.equal((await getListing(call, KEYBOARD)).savedCount, 1);
  }));

test('withdrawn saves count toward the limit of 100', () => {
  const listings = Array.from({ length: 101 }, (_, i) => ({
    id: `b${i + 1}`,
    title: `Item ${i + 1}`,
    description: '',
    priceYen: 500,
    sellerId: 'u2',
    status: 'on_sale',
    buyerId: null,
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: null,
  }));
  return withServer(
    async (call) => {
      for (let i = 1; i <= 100; i += 1) assert.equal((await save(call, `b${i}`, 'u1')).status, 200);
      assert.equal((await withdraw(call, 'b1')).status, 200);
      const saved = (await call('GET', '/api/me/favorites', { userId: 'u1' })).body.listings;
      assert.equal(saved.length, 100);
      assert.equal(saved.filter((l) => l.status === 'withdrawn').length, 1);
      assertError(await save(call, 'b101', 'u1'), 409, 'favorites_limit_reached');
      assert.equal((await unsave(call, 'b1', 'u1')).status, 200);
      assert.equal((await savedIds(call, 'u1')).length, 99);
      assert.equal((await save(call, 'b101', 'u1')).status, 200);
    },
    { store: createStore({ listings }) },
  );
});

test('withdrawing a new listing leaves the other listings in order', () =>
  withServer(async (call) => {
    const order = await listIds(call);
    const created = await call('POST', '/api/listings', {
      userId: 'u2',
      body: { title: 'Desk lamp', description: '', priceYen: 1200 },
    });
    const lamp = created.body.listing.id;
    assert.equal((await listIds(call))[0], lamp);
    const res = await withdraw(call, lamp);
    assert.deepEqual([res.status, res.body.listing.status], [200, 'withdrawn']);
    assert.deepEqual(await listIds(call), order);
    assert.deepEqual(await listIds(call, '?q=lamp'), []);

    const camera = await withdraw(call, 'l1', 'u1');
    assert.deepEqual([camera.status, camera.body.listing.status], [200, 'withdrawn']);
    assert.deepEqual(await listIds(call), ['l5', 'l4', 'l3', 'l2']);
  }));
