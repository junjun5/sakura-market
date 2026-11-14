import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../src/errors.js';
import { createFavoriteService, MAX_FAVORITES } from '../src/favorites.js';
import { createListingService } from '../src/listings.js';
import { createStore } from '../src/store.js';

const hana = { id: 'u1', name: 'Hana' };
const ken = { id: 'u2', name: 'Ken' };
const mio = { id: 'u3', name: 'Mio' };

// l2 is Ken's helmet, l4 is Mio's sold stove, l1 is Hana's camera (seed data).
const HELMET = 'l2';

function createClock(start = '2026-05-01T00:00:00.000Z') {
  let ms = Date.parse(start);
  return {
    now: () => new Date(ms),
    advance(seconds = 1) {
      ms += seconds * 1000;
    },
  };
}

function setup({ store = createStore() } = {}) {
  const clock = createClock();
  const favorites = createFavoriteService(store, { now: clock.now });
  return { store, clock, favorites };
}

// Store with `count` listings all sold by Ken; every `soldEvery`-th one is already sold.
function bulkStore(count, { soldEvery = 0 } = {}) {
  const listings = Array.from({ length: count }, (_, i) => ({
    id: `b${i + 1}`,
    title: `Item ${i + 1}`,
    description: '',
    priceYen: 1000,
    sellerId: 'u2',
    status: soldEvery && (i + 1) % soldEvery === 0 ? 'sold' : 'on_sale',
    buyerId: soldEvery && (i + 1) % soldEvery === 0 ? 'u3' : null,
    createdAt: '2026-04-01T09:00:00.000Z',
  }));
  return createStore({ listings });
}

function savedIds(favorites, user) {
  return favorites.listSaved(user).map((l) => l.id);
}

function assertAppError(fn, status, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof AppError, `expected AppError, got ${err}`);
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    assert.ok(err.message.length > 0);
    return true;
  });
}

test('MAX_FAVORITES is 100', () => {
  assert.equal(MAX_FAVORITES, 100);
});

test('fresh stores start with no favorites and stay independent', () => {
  const a = setup();
  const b = setup();
  for (const listing of a.store.listListings()) {
    assert.equal(a.favorites.decorate(listing, null).savedCount, 0);
  }
  assert.deepEqual(savedIds(a.favorites, hana), []);

  a.favorites.save(hana, HELMET);
  assert.equal(a.favorites.decorate(a.store.getListing(HELMET), null).savedCount, 1);
  assert.equal(b.favorites.decorate(b.store.getListing(HELMET), null).savedCount, 0);
  assert.deepEqual(savedIds(b.favorites, hana), []);

  const fresh = setup();
  assert.equal(fresh.favorites.decorate(fresh.store.getListing(HELMET), null).savedCount, 0);
  assert.deepEqual(savedIds(fresh.favorites, hana), []);
});

test('favorite state lives in the store, not the service', () => {
  const store = createStore();
  createFavoriteService(store).save(hana, HELMET);
  const other = createFavoriteService(store);
  assert.deepEqual(savedIds(other, hana), [HELMET]);
  assert.equal(other.decorate(store.getListing(HELMET), mio).savedCount, 1);
});

test('save returns the listing with its count and the caller flag', () => {
  const { favorites } = setup();
  const listing = favorites.save(hana, HELMET);
  assert.equal(listing.id, HELMET);
  assert.equal(listing.title, 'Road bike helmet (M)');
  assert.equal(listing.savedCount, 1);
  assert.equal(listing.savedByMe, true);
  assert.deepEqual(savedIds(favorites, hana), [HELMET]);
});

test('saving an already-saved listing changes nothing', () => {
  const { store, clock, favorites } = setup();
  favorites.save(hana, 'l2');
  const savedAt = store.getFavorite('u1', 'l2').savedAt;
  clock.advance();
  favorites.save(hana, 'l3');
  clock.advance();

  const again = favorites.save(hana, 'l2');
  assert.equal(again.savedCount, 1);
  assert.equal(again.savedByMe, true);
  assert.equal(store.getFavorite('u1', 'l2').savedAt, savedAt);
  assert.deepEqual(savedIds(favorites, hana), ['l3', 'l2']);
  assert.equal(favorites.decorate(store.getListing('l3'), null).savedCount, 1);
});

test('a user cannot save their own listing', () => {
  const { store, favorites } = setup();
  favorites.save(ken, 'l1');
  assertAppError(() => favorites.save(ken, HELMET), 409, 'own_listing');
  assert.equal(store.getFavorite('u2', HELMET), null);
  assert.equal(favorites.decorate(store.getListing(HELMET), null).savedCount, 0);
  assert.deepEqual(savedIds(favorites, ken), ['l1']);
});

test('removing an unsaved own listing succeeds', () => {
  const { favorites } = setup();
  const listing = favorites.remove(ken, HELMET);
  assert.equal(listing.id, HELMET);
  assert.equal(listing.savedCount, 0);
  assert.equal(listing.savedByMe, false);
});

test('saving or removing a missing listing is not found and changes nothing', () => {
  const { store, favorites } = setup();
  favorites.save(hana, 'l2');
  favorites.save(hana, 'l3');
  assertAppError(() => favorites.save(hana, 'nope'), 404, 'listing_not_found');
  assertAppError(() => favorites.remove(hana, 'nope'), 404, 'listing_not_found');
  assert.deepEqual(savedIds(favorites, hana), ['l3', 'l2']);
  assert.equal(store.getFavorite('u1', 'nope'), null);
});

test('removal is idempotent and only affects the caller', () => {
  const { store, favorites } = setup();
  favorites.save(hana, HELMET);
  favorites.save(mio, HELMET);

  const removed = favorites.remove(hana, HELMET);
  assert.equal(removed.savedCount, 1);
  assert.equal(removed.savedByMe, false);
  assert.deepEqual(savedIds(favorites, hana), []);

  const again = favorites.remove(hana, HELMET);
  assert.equal(again.savedCount, 1);
  assert.equal(again.savedByMe, false);

  const neverSaved = favorites.remove(hana, 'l3');
  assert.equal(neverSaved.savedCount, 0);

  assert.deepEqual(savedIds(favorites, mio), [HELMET]);
  assert.equal(favorites.decorate(store.getListing(HELMET), mio).savedByMe, true);

  favorites.remove(mio, HELMET);
  favorites.remove(mio, HELMET);
  assert.equal(favorites.decorate(store.getListing(HELMET), null).savedCount, 0);
});

test('saved listings are newest first', () => {
  const { clock, favorites } = setup();
  favorites.save(hana, 'l2');
  clock.advance();
  favorites.save(hana, 'l3');
  clock.advance();
  favorites.save(hana, 'l5');
  assert.deepEqual(savedIds(favorites, hana), ['l5', 'l3', 'l2']);
  assert.deepEqual(savedIds(favorites, hana), ['l5', 'l3', 'l2']);
});

test('saves with the same timestamp are ordered by insertion, newest first', () => {
  const { favorites } = setup();
  favorites.save(hana, 'l2');
  favorites.save(hana, 'l3');
  favorites.save(hana, 'l5');
  assert.deepEqual(savedIds(favorites, hana), ['l5', 'l3', 'l2']);
  favorites.save(hana, 'l2');
  favorites.save(hana, 'l3');
  assert.deepEqual(savedIds(favorites, hana), ['l5', 'l3', 'l2']);
});

test('removing and saving again moves the listing to the front', () => {
  for (const tick of [0, 1]) {
    const { store, clock, favorites } = setup();
    favorites.save(hana, 'l2');
    clock.advance(tick);
    favorites.save(hana, 'l3');
    clock.advance(tick);
    favorites.save(hana, 'l5');
    clock.advance(tick);
    favorites.save(mio, 'l2');

    favorites.remove(hana, 'l2');
    assert.deepEqual(savedIds(favorites, hana), ['l5', 'l3']);
    clock.advance(tick);
    const resaved = favorites.save(hana, 'l2');
    assert.equal(resaved.savedCount, 2);
    assert.deepEqual(savedIds(favorites, hana), ['l2', 'l5', 'l3']);
    assert.equal(favorites.decorate(store.getListing('l2'), null).savedCount, 2);
  }
});

test('saved count counts distinct users', () => {
  const { store, favorites } = setup();
  favorites.save(hana, HELMET);
  favorites.save(hana, HELMET);
  favorites.save(mio, HELMET);
  favorites.save(mio, HELMET);
  const helmet = store.getListing(HELMET);
  for (const viewer of [null, undefined, hana, ken, mio]) {
    assert.equal(favorites.decorate(helmet, viewer).savedCount, 2);
  }
});

test('savedByMe is true only for viewers who saved the listing', () => {
  const { store, favorites } = setup();
  favorites.save(hana, HELMET);
  const helmet = store.getListing(HELMET);
  assert.equal(favorites.decorate(helmet, hana).savedByMe, true);
  assert.equal(favorites.decorate(helmet, mio).savedByMe, false);
  assert.equal(favorites.decorate(helmet, ken).savedByMe, false);
  assert.equal(favorites.decorate(helmet, null).savedByMe, false);
  assert.equal(favorites.decorate(helmet, undefined).savedByMe, false);
  assert.equal(favorites.decorate(helmet, { id: 'ghost' }).savedByMe, false);

  const all = favorites.decorateAll(store.listListings(), hana);
  assert.deepEqual(
    all.map((l) => [l.id, l.savedCount, l.savedByMe]),
    [
      ['l1', 0, false],
      ['l2', 1, true],
      ['l3', 0, false],
      ['l4', 0, false],
      ['l5', 0, false],
    ],
  );
});

test('decoration adds only the count and caller flag and leaves the listing untouched', () => {
  const { store, favorites } = setup();
  favorites.save(hana, HELMET);
  favorites.save(mio, HELMET);
  const helmet = store.getListing(HELMET);
  const before = { ...helmet };
  const decorated = favorites.decorate(helmet, hana);
  assert.deepEqual(decorated, { ...before, savedCount: 2, savedByMe: true });
  assert.deepEqual(store.getListing(HELMET), before);
  for (const listing of favorites.listSaved(hana)) {
    assert.deepEqual(Object.keys(listing).sort(), [...Object.keys(before), 'savedByMe', 'savedCount'].sort());
  }
});

test('the private list only contains the caller saves', () => {
  const { favorites } = setup();
  favorites.save(hana, 'l2');
  favorites.save(hana, 'l3');
  favorites.save(mio, 'l2');
  favorites.save(mio, 'l1');
  assert.deepEqual(savedIds(favorites, hana), ['l3', 'l2']);
  assert.deepEqual(savedIds(favorites, mio), ['l1', 'l2']);
  assert.deepEqual(savedIds(favorites, ken), []);
  for (const listing of favorites.listSaved(mio)) assert.equal(listing.savedByMe, true);
});

test('a saved listing that is later sold stays in place with live sold state', () => {
  const store = createStore();
  const clock = createClock();
  const favorites = createFavoriteService(store, { now: clock.now });
  const listings = createListingService(store);
  favorites.save(mio, 'l3');
  clock.advance();
  favorites.save(mio, HELMET);
  clock.advance();
  favorites.save(mio, 'l1');

  listings.purchase(hana, HELMET);

  const saved = favorites.listSaved(mio);
  assert.deepEqual(
    saved.map((l) => l.id),
    ['l1', HELMET, 'l3'],
  );
  assert.equal(saved[1].status, 'sold');
  assert.equal(saved[1].buyerId, 'u1');
  assert.equal(saved[1].savedCount, 1);
  assert.equal(saved[1].savedByMe, true);
  assert.equal(favorites.decorate(store.getListing(HELMET), hana).savedByMe, false);
});

test('sold listings can be saved, saved again, and removed', () => {
  const { favorites } = setup();
  const saved = favorites.save(hana, 'l4');
  assert.equal(saved.status, 'sold');
  assert.equal(saved.savedCount, 1);
  assert.deepEqual(
    favorites.listSaved(hana).map((l) => [l.id, l.status]),
    [['l4', 'sold']],
  );
  assert.equal(favorites.save(hana, 'l4').savedCount, 1);
  const removed = favorites.remove(hana, 'l4');
  assert.equal(removed.savedCount, 0);
  assert.equal(favorites.remove(hana, 'l4').savedCount, 0);
  assert.deepEqual(savedIds(favorites, hana), []);
});

test('exactly MAX_FAVORITES saves are allowed and one more is rejected', () => {
  const { store, favorites } = setup({ store: bulkStore(MAX_FAVORITES + 2) });
  for (let i = 1; i <= MAX_FAVORITES; i += 1) {
    assert.equal(favorites.save(hana, `b${i}`).savedByMe, true);
  }
  const before = savedIds(favorites, hana);
  assert.equal(before.length, MAX_FAVORITES);

  assert.throws(
    () => favorites.save(hana, `b${MAX_FAVORITES + 1}`),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.status, 409);
      assert.equal(err.code, 'favorites_limit_reached');
      assert.match(err.message, /100/);
      return true;
    },
  );
  assert.deepEqual(savedIds(favorites, hana), before);
  const rejected = store.getListing(`b${MAX_FAVORITES + 1}`);
  assert.equal(favorites.decorate(rejected, null).savedCount, 0);
  assert.equal(store.getFavorite('u1', rejected.id), null);

  // The limit is per user.
  assert.equal(favorites.save(mio, `b${MAX_FAVORITES + 1}`).savedCount, 1);
});

test('saving an already-saved listing at capacity succeeds without changes', () => {
  const { store, favorites } = setup({ store: bulkStore(MAX_FAVORITES + 1) });
  for (let i = 1; i <= MAX_FAVORITES; i += 1) favorites.save(hana, `b${i}`);
  const before = savedIds(favorites, hana);
  const savedAt = store.getFavorite('u1', 'b50').savedAt;

  const again = favorites.save(hana, 'b50');
  assert.equal(again.savedCount, 1);
  assert.equal(again.savedByMe, true);
  assert.deepEqual(savedIds(favorites, hana), before);
  assert.equal(store.getFavorite('u1', 'b50').savedAt, savedAt);
});

test('removing at capacity frees exactly one slot', () => {
  const { clock, favorites } = setup({ store: bulkStore(MAX_FAVORITES + 2) });
  for (let i = 1; i <= MAX_FAVORITES; i += 1) {
    favorites.save(hana, `b${i}`);
    clock.advance();
  }
  favorites.remove(hana, 'b7');
  const replacement = favorites.save(hana, `b${MAX_FAVORITES + 1}`);
  assert.equal(replacement.savedByMe, true);

  const after = savedIds(favorites, hana);
  assert.equal(after.length, MAX_FAVORITES);
  assert.equal(after[0], `b${MAX_FAVORITES + 1}`);
  assert.ok(!after.includes('b7'));

  assertAppError(() => favorites.save(hana, `b${MAX_FAVORITES + 2}`), 409, 'favorites_limit_reached');
  assertAppError(() => favorites.save(hana, 'b7'), 409, 'favorites_limit_reached');
  assert.deepEqual(savedIds(favorites, hana), after);
});

test('sold saves count toward the limit', () => {
  const { favorites } = setup({ store: bulkStore(MAX_FAVORITES + 1, { soldEvery: 3 }) });
  for (let i = 1; i < MAX_FAVORITES; i += 1) favorites.save(hana, `b${i}`);
  const saved = favorites.listSaved(hana);
  assert.equal(saved.length, MAX_FAVORITES - 1);
  assert.ok(saved.some((l) => l.status === 'sold'));

  assert.equal(favorites.save(hana, `b${MAX_FAVORITES}`).savedByMe, true);
  assertAppError(() => favorites.save(hana, `b${MAX_FAVORITES + 1}`), 409, 'favorites_limit_reached');
  assert.equal(savedIds(favorites, hana).length, MAX_FAVORITES);
});
