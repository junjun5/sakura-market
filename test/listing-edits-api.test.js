import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createStore } from '../src/store.js';
import { assertError, LISTING_KEYS } from './support/api.js';
import { withServer } from './support/server.js';

const HELMET = 'l2'; // Ken's
const KEYBOARD = 'l3'; // Ken's
const STOVE = 'l4'; // Mio's, already sold
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PRICE_INVALID = 'priceYen must be an integer between 300 and 9999999.';

const edit = (call, id, body, userId = 'u2') => call('PATCH', `/api/listings/${id}`, { userId, body });
const getListing = async (call, id, userId) =>
  (await call('GET', `/api/listings/${id}`, { userId })).body.listing;
const listIds = async (call) => (await call('GET', '/api/listings')).body.listings.map((l) => l.id);

function assertErrorMessage(res, status, code, message) {
  assertError(res, status, code);
  assert.equal(res.body.error.message, message);
}

// Sends each request and checks that the listing looks exactly the same afterwards.
async function assertUnchangedAfter(call, id, requests) {
  const before = await getListing(call, id);
  for (const send of requests) await send();
  assert.deepEqual(await getListing(call, id), before);
}

test('PATCH /api/listings/:id changes the price for every viewer', () =>
  withServer(
    async (call) => {
      const res = await edit(call, HELMET, { priceYen: 3900 });
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.body), ['listing']);
      const { listing } = res.body;
      assert.deepEqual(Object.keys(listing).sort(), LISTING_KEYS);
      assert.deepEqual(listing, {
        id: HELMET,
        title: 'Road bike helmet (M)',
        description: 'Used for one season.',
        priceYen: 3900,
        sellerId: 'u2',
        status: 'on_sale',
        buyerId: null,
        createdAt: '2026-04-02T09:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
        savedCount: 0,
        savedByMe: false,
      });

      for (const userId of [undefined, 'u1', 'u3']) {
        assert.equal((await getListing(call, HELMET, userId)).priceYen, 3900);
        const all = await call('GET', '/api/listings', { userId });
        assert.equal(all.body.listings.find((l) => l.id === HELMET).priceYen, 3900);
      }
    },
    { now: () => new Date('2026-05-01T00:00:00.000Z') },
  ));

test('PATCH /api/listings/:id updates one, two or three fields and trims text', () =>
  withServer(async (call) => {
    const described = await edit(call, HELMET, { description: 'Used for one season. Includes spare pads.' });
    assert.equal(described.status, 200);
    assert.deepEqual(
      [described.body.listing.title, described.body.listing.priceYen],
      ['Road bike helmet (M)', 4500],
    );
    assert.equal((await getListing(call, HELMET)).description, 'Used for one season. Includes spare pads.');

    const two = await edit(call, KEYBOARD, { title: 'Keyboard', priceYen: 7000 });
    assert.deepEqual(
      [two.body.listing.title, two.body.listing.description, two.body.listing.priceYen],
      ['Keyboard', 'Brown switches, JIS layout.', 7000],
    );
    await edit(call, KEYBOARD, { title: 'Keyboard TKL', description: 'Tenkeyless.', priceYen: 6500 });
    const keyboard = await getListing(call, KEYBOARD);
    assert.deepEqual(
      [keyboard.title, keyboard.description, keyboard.priceYen],
      ['Keyboard TKL', 'Tenkeyless.', 6500],
    );

    const trimmed = await edit(call, HELMET, { title: '  Helmet M  ', description: '  Like new.  ' });
    assert.deepEqual(
      [trimmed.body.listing.title, trimmed.body.listing.description],
      ['Helmet M', 'Like new.'],
    );
  }));

test('PATCH /api/listings/:id rejects invalid values and leaves the listing unchanged', () =>
  withServer(async (call) =>
    assertUnchangedAfter(call, HELMET, [
      async () =>
        assertErrorMessage(
          await edit(call, HELMET, { title: '' }),
          400,
          'invalid_title',
          'title is required.',
        ),
      async () =>
        assertErrorMessage(
          await edit(call, HELMET, { title: '   ' }),
          400,
          'invalid_title',
          'title is required.',
        ),
      async () =>
        assertErrorMessage(
          await edit(call, HELMET, { title: 'a'.repeat(81) }),
          400,
          'invalid_title',
          'title must be 80 characters or fewer.',
        ),
      async () =>
        assertErrorMessage(
          await edit(call, HELMET, { description: 'd'.repeat(1001) }),
          400,
          'invalid_description',
          'description must be 1000 characters or fewer.',
        ),
      ...[299, 100, 10_000_000, 3900.5, '3900'].map(
        (priceYen) => async () =>
          assertErrorMessage(await edit(call, HELMET, { priceYen }), 400, 'invalid_price', PRICE_INVALID),
      ),
      async () =>
        assertError(
          await edit(call, HELMET, { title: 'New helmet title', description: 'New text', priceYen: 100 }),
          400,
          'invalid_price',
        ),
      async () => assertError(await edit(call, HELMET, { title: '', priceYen: 3900 }), 400, 'invalid_title'),
    ]),
  ));

test('PATCH /api/listings/:id keeps the last good price when a later change is rejected', () =>
  withServer(async (call) => {
    assert.equal((await edit(call, HELMET, { priceYen: 3900 })).status, 200);
    assertError(await edit(call, HELMET, { priceYen: 100 }), 400, 'invalid_price');
    assert.equal((await getListing(call, HELMET)).priceYen, 3900);
  }));

test('PATCH /api/listings/:id accepts the boundary values', () =>
  withServer(async (call) => {
    const c80 = 'c'.repeat(80);
    assert.equal((await edit(call, HELMET, { title: 'b'.repeat(80) })).body.listing.title.length, 80);
    assert.equal((await edit(call, HELMET, { title: `  ${c80}  ` })).body.listing.title, c80);
    assert.equal(
      (await edit(call, HELMET, { description: 'e'.repeat(1000) })).body.listing.description.length,
      1000,
    );
    assert.equal((await edit(call, HELMET, { description: '' })).body.listing.description, '');
    assert.equal((await edit(call, HELMET, { priceYen: 300 })).body.listing.priceYen, 300);
    assert.equal((await edit(call, HELMET, { priceYen: 9_999_999 })).body.listing.priceYen, 9_999_999);
  }));

test('PATCH /api/listings/:id without an editable field returns no_changes', () =>
  withServer(async (call) =>
    assertUnchangedAfter(
      call,
      HELMET,
      ['{}', '{"foo":1}', '{"status":"withdrawn"}', '[]', '"text"', '42', 'null', ''].map(
        (body) => async () =>
          assertErrorMessage(
            await call('PATCH', `/api/listings/${HELMET}`, {
              userId: 'u2',
              body,
              headers: { 'content-type': 'application/json' },
            }),
            400,
            'no_changes',
            'Provide at least one of title, description or priceYen.',
          ),
      ),
    ),
  ));

test('PATCH /api/listings/:id ignores fields that cannot be edited', () =>
  withServer(async (call) => {
    const before = Date.now();
    const res = await edit(call, HELMET, {
      priceYen: 4000,
      status: 'sold',
      sellerId: 'u1',
      buyerId: 'u3',
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      id: 'l99',
    });
    assert.equal(res.status, 200);
    const { listing } = res.body;
    assert.deepEqual(
      [listing.id, listing.priceYen, listing.status, listing.sellerId, listing.buyerId, listing.createdAt],
      [HELMET, 4000, 'on_sale', 'u2', null, '2026-04-02T09:00:00.000Z'],
    );
    assert.match(listing.updatedAt, ISO_UTC);
    assert.ok(Date.parse(listing.updatedAt) >= before - 1);
    assert.equal((await call('GET', '/api/listings/l99')).status, 404);
  }));

test('PATCH /api/listings/:id checks the user, the listing, the seller and the status', () =>
  withServer(async (call) => {
    await assertUnchangedAfter(call, HELMET, [
      async () => assertError(await edit(call, HELMET, { priceYen: 3900 }, null), 401, 'unauthorized'),
      async () => assertError(await edit(call, HELMET, { priceYen: 3900 }, 'u999'), 401, 'unauthorized'),
      async () => assertError(await edit(call, 'l999', '{"priceYen":', null), 401, 'unauthorized'),
      async () =>
        assertErrorMessage(
          await edit(call, HELMET, { priceYen: 3900 }, 'u1'),
          403,
          'not_seller',
          'Only the seller can change this listing.',
        ),
      async () => assertError(await edit(call, HELMET, {}, 'u1'), 403, 'not_seller'),
      async () =>
        assertErrorMessage(
          await edit(call, HELMET, '{"priceYen":'),
          400,
          'invalid_json',
          'Request body must be valid JSON.',
        ),
      async () =>
        assertError(
          await edit(call, HELMET, JSON.stringify({ title: 'x'.repeat(70 * 1024) })),
          400,
          'body_too_large',
        ),
    ]);
    assertErrorMessage(
      await edit(call, 'l999', { priceYen: 3900 }),
      404,
      'listing_not_found',
      'Listing l999 does not exist.',
    );
    await assertUnchangedAfter(call, STOVE, [
      async () =>
        assertErrorMessage(
          await edit(call, STOVE, { priceYen: 3000 }, 'u3'),
          409,
          'already_sold',
          'This listing has already been sold.',
        ),
    ]);
    const stove = await getListing(call, STOVE);
    assert.deepEqual([stove.priceYen, stove.status, stove.buyerId], [3200, 'sold', 'u1']);
  }));

test('PATCH /api/listings/:id refuses a withdrawn listing', () => {
  const seed = createStore().listListings();
  const withdrawn = { ...seed.find((l) => l.id === KEYBOARD), status: 'withdrawn' };
  return withServer(
    async (call) =>
      assertUnchangedAfter(
        call,
        KEYBOARD,
        [{ priceYen: 7000 }, {}].map(
          (body) => async () =>
            assertErrorMessage(
              await edit(call, KEYBOARD, body),
              409,
              'listing_withdrawn',
              'This listing has been withdrawn.',
            ),
        ),
      ),
    { store: createStore({ listings: seed.map((l) => (l.id === KEYBOARD ? withdrawn : l)) }) },
  );
});

test('updatedAt is null until the first edit and then holds the time of the latest edit', () =>
  withServer(async (call) => {
    const all = (await call('GET', '/api/listings')).body.listings;
    assert.ok(all.every((l) => l.updatedAt === null));
    const created = await call('POST', '/api/listings', {
      userId: 'u2',
      body: { title: 'Lamp', priceYen: 900 },
    });
    assert.equal(created.body.listing.updatedAt, null);

    const t0 = new Date().toISOString();
    const first = (await edit(call, HELMET, { priceYen: 3900 })).body.listing;
    assert.match(first.updatedAt, ISO_UTC);
    assert.ok(first.updatedAt >= t0);
    assert.equal(first.createdAt, '2026-04-02T09:00:00.000Z');
    const second = (await edit(call, HELMET, { priceYen: 3800 })).body.listing;
    assert.ok(second.updatedAt >= first.updatedAt);
    assert.equal(second.createdAt, '2026-04-02T09:00:00.000Z');
  }));

test('edits keep the listing order and every save', () =>
  withServer(async (call) => {
    const favorites = async (userId) =>
      (await call('GET', '/api/me/favorites', { userId })).body.listings.map((l) => [l.id, l.priceYen]);
    for (const [userId, id] of [
      ['u1', HELMET],
      ['u1', KEYBOARD],
      ['u3', HELMET],
    ]) {
      assert.equal((await call('PUT', `/api/listings/${id}/favorite`, { userId })).status, 200);
    }
    const order = await listIds(call);
    assert.deepEqual(order, ['l5', 'l4', 'l3', 'l2', 'l1']);

    const res = await edit(call, HELMET, { title: 'Zzz helmet', priceYen: 3900 });
    assert.deepEqual([res.body.listing.savedCount, res.body.listing.savedByMe], [2, false]);
    await edit(call, KEYBOARD, { title: 'Aaa keyboard' });

    assert.deepEqual(await listIds(call), order);
    for (const [userId, savedByMe] of [
      ['u1', true],
      ['u3', true],
      ['u2', false],
      [undefined, false],
    ]) {
      const helmet = await getListing(call, HELMET, userId);
      assert.deepEqual([helmet.savedCount, helmet.savedByMe], [2, savedByMe]);
    }
    assert.deepEqual(await favorites('u1'), [
      [KEYBOARD, 7800],
      [HELMET, 3900],
    ]);
    assert.deepEqual(await favorites('u3'), [[HELMET, 3900]]);
  }));
