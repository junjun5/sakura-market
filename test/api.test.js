import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLogger } from '../src/logger.js';
import { REDACTED } from '../src/redact.js';
import { createStore } from '../src/store.js';
import { assertError, LISTING_KEYS } from './support/api.js';
import { withServer } from './support/server.js';

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

    const invalid = await call('POST', '/api/listings', {
      userId: 'u1',
      body: { title: 'Lamp', priceYen: 1 },
    });
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

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

const HELMET = 'l2'; // Ken's
const KEYBOARD = 'l3'; // Ken's
const STOVE = 'l4'; // Mio's, already sold
const BOOKS = 'l5'; // Mio's

const ids = (res) => res.body.listings.map((l) => l.id);
const savedIds = async (call, userId) => ids(await call('GET', '/api/me/favorites', { userId }));
const countOf = async (call, id) => (await call('GET', `/api/listings/${id}`)).body.listing.savedCount;

// A clock that moves forward one second on every read, or stays put when `step` is 0.
function tickingClock(step = 1000, start = '2026-05-01T00:00:00.000Z') {
  let ms = Date.parse(start);
  return () => {
    const at = new Date(ms);
    ms += step;
    return at;
  };
}

// Store with `count` listings sold by Ken; every `soldEvery`-th one is already sold.
function bulkStore(count, { soldEvery = 0 } = {}) {
  const listings = Array.from({ length: count }, (_, i) => {
    const sold = soldEvery > 0 && (i + 1) % soldEvery === 0;
    return {
      id: `b${i + 1}`,
      title: `Item ${i + 1}`,
      description: '',
      priceYen: 1000,
      sellerId: 'u2',
      status: sold ? 'sold' : 'on_sale',
      buyerId: sold ? 'u3' : null,
      createdAt: '2026-04-01T09:00:00.000Z',
      updatedAt: null,
    };
  });
  return createStore({ listings });
}

async function saveAll(call, userId, listingIds) {
  for (const id of listingIds) {
    const res = await call('PUT', `/api/listings/${id}/favorite`, { userId });
    assert.equal(res.status, 200, `saving ${id}: ${JSON.stringify(res.body)}`);
  }
}

// Favorite information on a listing is only the aggregate count and the caller's flag.
function assertDecorated(listing, { savedCount, savedByMe } = {}) {
  assert.deepEqual(Object.keys(listing).sort(), LISTING_KEYS);
  assert.equal(typeof listing.savedCount, 'number');
  assert.ok(Number.isInteger(listing.savedCount) && listing.savedCount >= 0);
  assert.equal(typeof listing.savedByMe, 'boolean');
  if (savedCount !== undefined) assert.equal(listing.savedCount, savedCount);
  if (savedByMe !== undefined) assert.equal(listing.savedByMe, savedByMe);
}

test("favorites: Hana saves Ken's helmet", () =>
  withServer(async (call) => {
    const before = await call('GET', `/api/listings/${HELMET}`, { userId: 'u1' });
    assertDecorated(before.body.listing, { savedCount: 0, savedByMe: false });

    const saved = await call('PUT', `/api/listings/${HELMET}/favorite`, { userId: 'u1' });
    assert.equal(saved.status, 200);
    assert.deepEqual(Object.keys(saved.body), ['listing']);
    assert.equal(saved.body.listing.id, HELMET);
    assertDecorated(saved.body.listing, { savedCount: 1, savedByMe: true });

    const list = await call('GET', '/api/me/favorites', { userId: 'u1' });
    assert.equal(list.status, 200);
    assert.deepEqual(Object.keys(list.body), ['listings']);
    assert.deepEqual(ids(list), [HELMET]);
    assertDecorated(list.body.listings[0], { savedCount: 1, savedByMe: true });
  }));

test('favorites: saving again succeeds and changes nothing', () =>
  withServer(
    async (call) => {
      await saveAll(call, 'u1', [HELMET, KEYBOARD]);
      assert.deepEqual(await savedIds(call, 'u1'), [KEYBOARD, HELMET]);

      const again = await call('PUT', `/api/listings/${HELMET}/favorite`, { userId: 'u1' });
      assert.equal(again.status, 200);
      assertDecorated(again.body.listing, { savedCount: 1, savedByMe: true });

      assert.deepEqual(await savedIds(call, 'u1'), [KEYBOARD, HELMET]);
      assert.equal(await countOf(call, HELMET), 1);
      assert.equal(await countOf(call, KEYBOARD), 1);
    },
    { now: tickingClock() },
  ));

test('favorites: removing is idempotent and only touches the caller', () =>
  withServer(
    async (call) => {
      await saveAll(call, 'u1', [HELMET]);
      await saveAll(call, 'u3', [HELMET, KEYBOARD]);
      assert.equal(await countOf(call, HELMET), 2);

      const removed = await call('DELETE', `/api/listings/${HELMET}/favorite`, { userId: 'u1' });
      assert.equal(removed.status, 200);
      assert.deepEqual(Object.keys(removed.body), ['listing']);
      assertDecorated(removed.body.listing, { savedCount: 1, savedByMe: false });
      assert.deepEqual(await savedIds(call, 'u1'), []);

      const repeated = await call('DELETE', `/api/listings/${HELMET}/favorite`, { userId: 'u1' });
      assert.equal(repeated.status, 200);
      assertDecorated(repeated.body.listing, { savedCount: 1, savedByMe: false });

      // Hana never saved the keyboard; removing it must leave Mio's save alone.
      const neverSaved = await call('DELETE', `/api/listings/${KEYBOARD}/favorite`, { userId: 'u1' });
      assert.equal(neverSaved.status, 200);
      assertDecorated(neverSaved.body.listing, { savedCount: 1, savedByMe: false });

      assert.deepEqual(await savedIds(call, 'u3'), [KEYBOARD, HELMET]);
      assert.equal(await countOf(call, HELMET), 1);
      assert.equal(await countOf(call, KEYBOARD), 1);
    },
    { now: tickingClock() },
  ));

test('favorites: Ken cannot save his own helmet', () =>
  withServer(async (call) => {
    await saveAll(call, 'u2', [BOOKS]);

    const own = await call('PUT', `/api/listings/${HELMET}/favorite`, { userId: 'u2' });
    assertError(own, 409, 'own_listing');
    assert.match(own.body.error.message, /own listing/i);

    assert.equal(await countOf(call, HELMET), 0);
    assert.deepEqual(await savedIds(call, 'u2'), [BOOKS]);

    const ownDelete = await call('DELETE', `/api/listings/${HELMET}/favorite`, { userId: 'u2' });
    assert.equal(ownDelete.status, 200);
    assertDecorated(ownDelete.body.listing, { savedCount: 0, savedByMe: false });
    assert.deepEqual(await savedIds(call, 'u2'), [BOOKS]);
  }));

test('favorites: missing listings return 404 for save and remove', () =>
  withServer(
    async (call) => {
      await saveAll(call, 'u1', [HELMET, KEYBOARD]);

      assertError(
        await call('PUT', '/api/listings/nope/favorite', { userId: 'u1' }),
        404,
        'listing_not_found',
      );
      assertError(
        await call('DELETE', '/api/listings/nope/favorite', { userId: 'u1' }),
        404,
        'listing_not_found',
      );

      assert.deepEqual(await savedIds(call, 'u1'), [KEYBOARD, HELMET]);
      assert.equal(await countOf(call, HELMET), 1);
      assert.equal(await countOf(call, KEYBOARD), 1);
    },
    { now: tickingClock() },
  ));

test('favorites: exactly 100 saves are allowed and the 101st is rejected', () =>
  withServer(
    async (call) => {
      const first100 = Array.from({ length: 100 }, (_, i) => `b${i + 1}`);
      await saveAll(call, 'u1', first100.slice(0, 99));

      const hundredth = await call('PUT', '/api/listings/b100/favorite', { userId: 'u1' });
      assert.equal(hundredth.status, 200);
      assertDecorated(hundredth.body.listing, { savedCount: 1, savedByMe: true });

      const before = await savedIds(call, 'u1');
      assert.deepEqual(before, [...first100].reverse());

      const over = await call('PUT', '/api/listings/b101/favorite', { userId: 'u1' });
      assertError(over, 409, 'favorites_limit_reached');
      assert.match(over.body.error.message, /100/);

      assert.deepEqual(await savedIds(call, 'u1'), before);
      assert.equal(await countOf(call, 'b101'), 0);
    },
    { store: bulkStore(102), now: tickingClock() },
  ));

test('favorites: a duplicate save at capacity succeeds without changes', () =>
  withServer(
    async (call) => {
      await saveAll(
        call,
        'u1',
        Array.from({ length: 100 }, (_, i) => `b${i + 1}`),
      );
      const before = await savedIds(call, 'u1');
      assert.equal(before.length, 100);

      const dup = await call('PUT', '/api/listings/b50/favorite', { userId: 'u1' });
      assert.equal(dup.status, 200);
      assertDecorated(dup.body.listing, { savedCount: 1, savedByMe: true });

      assert.deepEqual(await savedIds(call, 'u1'), before);
      const all = await call('GET', '/api/listings');
      assert.equal(all.body.listings.filter((l) => l.savedCount === 1).length, 100);
      assert.equal(all.body.listings.find((l) => l.id === 'b101').savedCount, 0);
    },
    { store: bulkStore(101), now: tickingClock() },
  ));

test('favorites: removing at capacity frees exactly one slot', () =>
  withServer(
    async (call) => {
      await saveAll(
        call,
        'u1',
        Array.from({ length: 100 }, (_, i) => `b${i + 1}`),
      );

      const removed = await call('DELETE', '/api/listings/b50/favorite', { userId: 'u1' });
      assert.equal(removed.status, 200);
      const replacement = await call('PUT', '/api/listings/b101/favorite', { userId: 'u1' });
      assert.equal(replacement.status, 200);

      const after = await savedIds(call, 'u1');
      assert.equal(after.length, 100);
      assert.equal(after[0], 'b101');
      assert.ok(!after.includes('b50'));

      for (const id of ['b50', 'b102']) {
        assertError(
          await call('PUT', `/api/listings/${id}/favorite`, { userId: 'u1' }),
          409,
          'favorites_limit_reached',
        );
        assert.equal(await countOf(call, id), 0);
      }
      assert.deepEqual(await savedIds(call, 'u1'), after);
    },
    { store: bulkStore(102), now: tickingClock() },
  ));

test('favorites: saved listings are newest first', () =>
  withServer(
    async (call) => {
      await saveAll(call, 'u1', [HELMET, KEYBOARD, BOOKS]);
      assert.deepEqual(await savedIds(call, 'u1'), [BOOKS, KEYBOARD, HELMET]);
      await saveAll(call, 'u1', [HELMET, KEYBOARD]);
      assert.deepEqual(await savedIds(call, 'u1'), [BOOKS, KEYBOARD, HELMET]);
    },
    { now: tickingClock() },
  ));

test('favorites: equal save times fall back to save order', () =>
  withServer(
    async (call) => {
      await saveAll(call, 'u1', [HELMET, KEYBOARD, BOOKS]);
      assert.deepEqual(await savedIds(call, 'u1'), [BOOKS, KEYBOARD, HELMET]);
      assert.deepEqual(await savedIds(call, 'u1'), [BOOKS, KEYBOARD, HELMET]);
      await saveAll(call, 'u1', [HELMET]);
      assert.deepEqual(await savedIds(call, 'u1'), [BOOKS, KEYBOARD, HELMET]);
    },
    { now: tickingClock(0) },
  ));

for (const [label, step] of [
  ['increasing', 1000],
  ['equal', 0],
]) {
  test(`favorites: remove and save again moves to the front (${label} times)`, () =>
    withServer(
      async (call) => {
        await saveAll(call, 'u1', [HELMET, KEYBOARD, BOOKS]);
        await saveAll(call, 'u3', [HELMET]);
        assert.deepEqual(await savedIds(call, 'u1'), [BOOKS, KEYBOARD, HELMET]);

        await call('DELETE', `/api/listings/${HELMET}/favorite`, { userId: 'u1' });
        assert.deepEqual(await savedIds(call, 'u1'), [BOOKS, KEYBOARD]);
        assert.equal(await countOf(call, HELMET), 1);

        const resaved = await call('PUT', `/api/listings/${HELMET}/favorite`, { userId: 'u1' });
        assertDecorated(resaved.body.listing, { savedCount: 2, savedByMe: true });
        assert.deepEqual(await savedIds(call, 'u1'), [HELMET, BOOKS, KEYBOARD]);
        assert.equal(await countOf(call, HELMET), 2);
      },
      { now: tickingClock(step) },
    ));
}

test('favorites: all favorite routes need a known user', () =>
  withServer(async (call) => {
    await saveAll(call, 'u1', [HELMET]);

    for (const userId of [undefined, 'ghost']) {
      for (const [method, path] of [
        ['PUT', `/api/listings/${KEYBOARD}/favorite`],
        ['DELETE', `/api/listings/${HELMET}/favorite`],
        ['GET', '/api/me/favorites'],
      ]) {
        const res = await call(method, path, { userId });
        assertError(res, 401, 'unauthorized');
        assert.equal(res.body.listings, undefined);
      }
    }

    assert.deepEqual(await savedIds(call, 'u1'), [HELMET]);
    assert.equal(await countOf(call, HELMET), 1);
    assert.equal(await countOf(call, KEYBOARD), 0);
  }));

test('favorites: lists and mutations use only the authenticated user', () =>
  withServer(
    async (call) => {
      await saveAll(call, 'u1', [HELMET, KEYBOARD]);
      await saveAll(call, 'u3', [HELMET]);

      assert.deepEqual(await savedIds(call, 'u1'), [KEYBOARD, HELMET]);
      assert.deepEqual(await savedIds(call, 'u3'), [HELMET]);
      assert.deepEqual((await call('GET', '/api/me/favorites', { userId: 'u2' })).body, { listings: [] });

      for (const path of ['/api/me/favorites?userId=u3', '/api/me/favorites?user=u3&x-user-id=u3']) {
        assert.deepEqual(ids(await call('GET', path, { userId: 'u1' })), [KEYBOARD, HELMET]);
      }
      assert.deepEqual(ids(await call('GET', '/api/me/favorites?userId=u1', { userId: 'u3' })), [HELMET]);

      // Naming Mio in the query or body still acts as Hana: as Mio this would be an own-listing 409.
      const asHana = await call('PUT', `/api/listings/${BOOKS}/favorite?userId=u3`, {
        userId: 'u1',
        body: { userId: 'u3' },
      });
      assertDecorated(asHana.body.listing, { savedCount: 1, savedByMe: true });
      assert.deepEqual(await savedIds(call, 'u3'), [HELMET]);
      const saveFor = await call('PUT', `/api/listings/${STOVE}/favorite?userId=u2`, {
        userId: 'u1',
        body: { userId: 'u2' },
      });
      assertDecorated(saveFor.body.listing, { savedCount: 1, savedByMe: true });
      assert.deepEqual((await call('GET', '/api/me/favorites', { userId: 'u2' })).body, { listings: [] });

      const removeFor = await call('DELETE', `/api/listings/${HELMET}/favorite?userId=u3`, {
        userId: 'u1',
        body: { userId: 'u3' },
      });
      assertDecorated(removeFor.body.listing, { savedCount: 1, savedByMe: false });

      assert.deepEqual(await savedIds(call, 'u1'), [STOVE, BOOKS, KEYBOARD]);
      assert.deepEqual(await savedIds(call, 'u3'), [HELMET]);
      const mioView = await call('GET', `/api/listings/${HELMET}`, { userId: 'u3' });
      assertDecorated(mioView.body.listing, { savedCount: 1, savedByMe: true });
    },
    { now: tickingClock() },
  ));

test('favorites: saved counts are public and count distinct savers', () =>
  withServer(async (call) => {
    await saveAll(call, 'u1', [HELMET, HELMET]);
    await saveAll(call, 'u3', [HELMET, HELMET]);

    const viewers = [undefined, 'u2', 'u1', 'ghost'];
    for (const userId of viewers) {
      const list = await call('GET', '/api/listings', { userId });
      assert.equal(list.status, 200);
      const detail = await call('GET', `/api/listings/${HELMET}`, { userId });
      assert.equal(detail.status, 200);
      for (const listing of [list.body.listings.find((l) => l.id === HELMET), detail.body.listing]) {
        assertDecorated(listing, { savedCount: 2 });
      }
      if (userId === undefined || userId === 'ghost') {
        assert.equal(detail.body.listing.savedByMe, false);
        assert.ok(list.body.listings.every((l) => l.savedByMe === false));
      }
    }

    await call('DELETE', `/api/listings/${HELMET}/favorite`, { userId: 'u1' });
    assert.equal(await countOf(call, HELMET), 1);
    await call('DELETE', `/api/listings/${HELMET}/favorite`, { userId: 'u3' });
    assert.equal(await countOf(call, HELMET), 0);
    await call('DELETE', `/api/listings/${HELMET}/favorite`, { userId: 'u3' });
    assert.equal(await countOf(call, HELMET), 0);
  }));

test("favorites: every listing response carries the viewer's saved state", () =>
  withServer(
    async (call) => {
      await saveAll(call, 'u1', [HELMET]);

      for (const [userId, expected] of [
        ['u1', true],
        ['u3', false],
        ['u2', false],
        [undefined, false],
      ]) {
        const detail = await call('GET', `/api/listings/${HELMET}`, { userId });
        assertDecorated(detail.body.listing, { savedCount: 1, savedByMe: expected });
        const list = await call('GET', '/api/listings', { userId });
        list.body.listings.forEach((l) => assertDecorated(l));
        assertDecorated(
          list.body.listings.find((l) => l.id === HELMET),
          { savedCount: 1, savedByMe: expected },
        );
      }

      const filtered = await call('GET', '/api/listings?status=on_sale&q=helmet', { userId: 'u1' });
      assert.deepEqual(ids(filtered), [HELMET]);
      assertDecorated(filtered.body.listings[0], { savedCount: 1, savedByMe: true });

      const created = await call('POST', '/api/listings', {
        userId: 'u3',
        body: { title: 'Desk lamp', description: 'LED', priceYen: 2000 },
      });
      assert.equal(created.status, 201);
      assertDecorated(created.body.listing, { savedCount: 0, savedByMe: false });

      const boughtSaved = await call('POST', `/api/listings/${HELMET}/purchase`, { userId: 'u1' });
      assert.equal(boughtSaved.status, 200);
      assert.equal(boughtSaved.body.listing.status, 'sold');
      assert.equal(boughtSaved.body.listing.buyerId, 'u1');
      assertDecorated(boughtSaved.body.listing, { savedCount: 1, savedByMe: true });

      const boughtUnsaved = await call('POST', `/api/listings/${KEYBOARD}/purchase`, { userId: 'u3' });
      assert.equal(boughtUnsaved.status, 200);
      assertDecorated(boughtUnsaved.body.listing, { savedCount: 0, savedByMe: false });

      const mutation = await call('PUT', `/api/listings/${created.body.listing.id}/favorite`, {
        userId: 'u1',
      });
      assertDecorated(mutation.body.listing, { savedCount: 1, savedByMe: true });
      const removal = await call('DELETE', `/api/listings/${created.body.listing.id}/favorite`, {
        userId: 'u2',
      });
      assertDecorated(removal.body.listing, { savedCount: 1, savedByMe: false });
      (await call('GET', '/api/me/favorites', { userId: 'u1' })).body.listings.forEach((l) =>
        assertDecorated(l, { savedByMe: true }),
      );
    },
    { now: tickingClock() },
  ));

test('favorites: responses expose counts, never who saved', () =>
  withServer(
    async (call) => {
      await saveAll(call, 'u1', [HELMET]);
      await saveAll(call, 'u3', [HELMET, KEYBOARD]);

      const responses = [
        await call('GET', '/api/listings'),
        await call('GET', '/api/listings', { userId: 'u2' }),
        await call('GET', `/api/listings/${HELMET}`, { userId: 'u2' }),
        await call('POST', '/api/listings', { userId: 'u2', body: { title: 'Tent', priceYen: 5000 } }),
        await call('PUT', `/api/listings/${BOOKS}/favorite`, { userId: 'u1' }),
        await call('DELETE', `/api/listings/${BOOKS}/favorite`, { userId: 'u2' }),
        await call('POST', `/api/listings/${KEYBOARD}/purchase`, { userId: 'u1' }),
        await call('GET', '/api/me/favorites', { userId: 'u1' }),
      ];
      for (const res of responses) {
        assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
        const listings = res.body.listings ?? [res.body.listing];
        for (const listing of listings) {
          assertDecorated(listing);
          // Only seller and buyer fields may name a user.
          const { sellerId, buyerId, ...rest } = listing;
          assert.ok(!/\bu[0-9]+\b/.test(JSON.stringify(rest)), JSON.stringify(rest));
        }
      }
      // Hana's private list holds only her own saves, not Mio's keyboard.
      const hanaSaved = responses.at(-1).body.listings;
      assert.deepEqual(
        hanaSaved.map((l) => l.id),
        [BOOKS, HELMET],
      );
    },
    { now: tickingClock() },
  ));

test("favorites: a bought listing stays in Mio's saved list as sold", () =>
  withServer(
    async (call) => {
      await saveAll(call, 'u3', [KEYBOARD, HELMET]);
      await saveAll(call, 'u3', ['l1']);
      assert.deepEqual(await savedIds(call, 'u3'), ['l1', HELMET, KEYBOARD]);

      const bought = await call('POST', `/api/listings/${HELMET}/purchase`, { userId: 'u1' });
      assert.equal(bought.status, 200);
      assert.equal(bought.body.listing.status, 'sold');
      assert.equal(bought.body.listing.buyerId, 'u1');
      assertDecorated(bought.body.listing, { savedCount: 1, savedByMe: false });

      const saved = await call('GET', '/api/me/favorites', { userId: 'u3' });
      assert.deepEqual(ids(saved), ['l1', HELMET, KEYBOARD]);
      const helmet = saved.body.listings[1];
      assert.equal(helmet.status, 'sold');
      assert.equal(helmet.buyerId, 'u1');
      assertDecorated(helmet, { savedCount: 1, savedByMe: true });

      const publicRead = await call('GET', `/api/listings/${HELMET}`);
      assert.equal(publicRead.body.listing.status, 'sold');
      assert.equal(publicRead.body.listing.savedCount, 1);

      const onSale = await call('GET', '/api/listings?status=on_sale');
      assert.deepEqual(ids(onSale), [BOOKS, KEYBOARD, 'l1']);
      const sold = await call('GET', '/api/listings?status=sold');
      assert.deepEqual(ids(sold), [STOVE, HELMET]);
      assert.equal(
        (await call('POST', `/api/listings/${HELMET}/purchase`, { userId: 'u3' })).body.error.code,
        'already_sold',
      );
    },
    { now: tickingClock() },
  ));

test('favorites: sold listings can be saved and removed', () =>
  withServer(async (call) => {
    const saved = await call('PUT', `/api/listings/${STOVE}/favorite`, { userId: 'u2' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.listing.status, 'sold');
    assertDecorated(saved.body.listing, { savedCount: 1, savedByMe: true });

    const list = await call('GET', '/api/me/favorites', { userId: 'u2' });
    assert.deepEqual(ids(list), [STOVE]);
    assert.equal(list.body.listings[0].status, 'sold');

    assertDecorated((await call('PUT', `/api/listings/${STOVE}/favorite`, { userId: 'u2' })).body.listing, {
      savedCount: 1,
      savedByMe: true,
    });
    for (let i = 0; i < 2; i++) {
      const removed = await call('DELETE', `/api/listings/${STOVE}/favorite`, { userId: 'u2' });
      assert.equal(removed.status, 200);
      assertDecorated(removed.body.listing, { savedCount: 0, savedByMe: false });
    }
    assert.deepEqual(await savedIds(call, 'u2'), []);
  }));

test('favorites: sold saves count toward the 100 limit', () =>
  withServer(
    async (call) => {
      const store99 = Array.from({ length: 99 }, (_, i) => `b${i + 1}`);
      await saveAll(call, 'u1', store99);
      const listings = (await call('GET', '/api/me/favorites', { userId: 'u1' })).body.listings;
      assert.ok(listings.filter((l) => l.status === 'sold').length >= 30);

      assert.equal((await call('PUT', '/api/listings/b100/favorite', { userId: 'u1' })).status, 200);
      assertError(
        await call('PUT', '/api/listings/b101/favorite', { userId: 'u1' }),
        409,
        'favorites_limit_reached',
      );
      const after = await savedIds(call, 'u1');
      assert.equal(after.length, 100);
      assert.ok(!after.includes('b101'));
    },
    { store: bulkStore(101, { soldEvery: 3 }), now: tickingClock() },
  ));

test('favorites: the saved list ignores All-view filters', () =>
  withServer(
    async (call) => {
      await saveAll(call, 'u1', [STOVE, HELMET, BOOKS]);
      const expected = [BOOKS, HELMET, STOVE];

      assert.deepEqual(ids(await call('GET', '/api/listings?status=on_sale&q=helmet')), [HELMET]);
      for (const query of [
        '',
        '?status=on_sale',
        '?status=sold',
        '?q=helmet',
        '?q=nothing&status=on_sale',
        '?status=archived',
      ]) {
        const res = await call('GET', `/api/me/favorites${query}`, { userId: 'u1' });
        assert.equal(res.status, 200, query);
        assert.deepEqual(ids(res), expected, query);
      }
    },
    { now: tickingClock() },
  ));

test('favorites: state belongs to one store and starts empty', async () => {
  const store = createStore();
  await withServer(
    async (call) => {
      await saveAll(call, 'u1', [HELMET]);
      await withServer(async (other) => {
        assert.equal(await countOf(other, HELMET), 0);
        assert.deepEqual(await savedIds(other, 'u1'), []);
        assert.ok(
          (await other('GET', '/api/listings', { userId: 'u1' })).body.listings.every(
            (l) => l.savedCount === 0 && l.savedByMe === false,
          ),
        );
      });
      assert.equal(await countOf(call, HELMET), 1);
    },
    { store },
  );

  // A second app on the same store sees the saves; a fresh default app does not.
  await withServer(
    async (call) => {
      assert.deepEqual(await savedIds(call, 'u1'), [HELMET]);
    },
    { store },
  );
  await withServer(async (call) => {
    assert.equal(await countOf(call, HELMET), 0);
    assert.deepEqual(await savedIds(call, 'u1'), []);
  });
});

test('unexpected errors answer 500 and are logged without credentials or personal data', async () => {
  const lines = [];
  const logger = createLogger({ level: 'error', write: (line) => lines.push(JSON.parse(line)) });
  const store = createStore();
  store.listUsers = () => {
    throw new Error('lookup failed for hana@example.com with Bearer not-a-real-token');
  };

  let requestId;
  await withServer(
    async (call) => {
      const res = await call('GET', '/api/users', { userId: 'u1' });
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { error: { code: 'internal', message: 'Unexpected error.' } });
      requestId = res.headers.get('x-request-id');
    },
    { store, logger },
  );

  assert.equal(lines.length, 1);
  const [entry] = lines;
  assert.equal(entry.level, 'error');
  assert.equal(entry.msg, 'unhandled_error');
  assert.equal(entry.requestId, requestId);
  assert.equal(entry.method, 'GET');
  assert.equal(entry.path, '/api/users');
  assert.equal(entry.headers['x-user-id'], REDACTED);
  assert.match(entry.error.message, /^lookup failed for \[redacted\] with Bearer \[redacted\]$/);
  assert.doesNotMatch(JSON.stringify(lines), /hana@example\.com|not-a-real-token/);
});
