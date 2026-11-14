import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFavoriteService } from '../src/favorites.js';
import { createListingService, LIST_STATUSES } from '../src/listings.js';
import { createStore } from '../src/store.js';
import { assertAppError, assertRejectedUnchanged } from './support/errors.js';

const hana = { id: 'u1', name: 'Hana' };
const ken = { id: 'u2', name: 'Ken' };
const mio = { id: 'u3', name: 'Mio' };

// Seed data: l2 and l3 are Ken's on-sale helmet and keyboard, l4 is Mio's sold stove.
const HELMET = 'l2';
const KEYBOARD = 'l3';
const STOVE = 'l4';
const WITHDRAWN_MESSAGE = 'This listing has been withdrawn.';

function setup() {
  const store = createStore();
  let writes = 0;
  const updateListing = store.updateListing;
  store.updateListing = (...args) => {
    writes += 1;
    return updateListing(...args);
  };
  const service = createListingService(store, { now: () => new Date('2026-05-01T00:00:00.000Z') });
  return { store, service, writes: () => writes };
}

const ids = (listings) => listings.map((l) => l.id);

test('the list filter accepts only on_sale and sold', () => {
  assert.deepEqual(LIST_STATUSES, ['on_sale', 'sold']);
});

test('the seller withdraws an on-sale listing and nothing else changes', () => {
  const { store, service } = setup();
  const before = store.getListing(KEYBOARD);
  const withdrawn = service.withdraw(ken, KEYBOARD);
  assert.deepEqual(withdrawn, { ...before, status: 'withdrawn' });
  assert.equal(withdrawn.buyerId, null);
  assert.equal(withdrawn.updatedAt, null);
  assert.deepEqual(store.getListing(KEYBOARD), withdrawn);
  assert.equal(service.withdraw(hana, 'l1').status, 'withdrawn');
});

test('withdrawing again returns the listing without writing', () => {
  const { store, service, writes } = setup();
  const first = service.withdraw(ken, KEYBOARD);
  const count = writes();
  assert.deepEqual(service.withdraw(ken, KEYBOARD), first);
  assert.equal(writes(), count);
  assert.deepEqual(store.getListing(KEYBOARD), first);
});

test('withdrawing keeps updatedAt from the last edit', () => {
  const { service } = setup();
  const edited = service.edit(ken, HELMET, { priceYen: 3900 });
  const withdrawn = service.withdraw(ken, HELMET);
  assert.equal(withdrawn.updatedAt, edited.updatedAt);
  assert.equal(withdrawn.priceYen, 3900);
});

test('withdraw checks existence, then the seller, then the status', () => {
  const { store, service } = setup();
  assertAppError(
    () => service.withdraw(ken, 'l999'),
    404,
    'listing_not_found',
    'Listing l999 does not exist.',
  );
  for (const user of [hana, mio]) {
    assertRejectedUnchanged(store, HELMET, () => service.withdraw(user, HELMET), [
      403,
      'not_seller',
      'Only the seller can change this listing.',
    ]);
  }
  assertRejectedUnchanged(store, STOVE, () => service.withdraw(ken, STOVE), [403, 'not_seller']);
  assertRejectedUnchanged(store, STOVE, () => service.withdraw(mio, STOVE), [
    409,
    'already_sold',
    'This listing has already been sold.',
  ]);
  assert.deepEqual([store.getListing(STOVE).status, store.getListing(STOVE).buyerId], ['sold', 'u1']);

  service.withdraw(ken, KEYBOARD);
  assertRejectedUnchanged(store, KEYBOARD, () => service.withdraw(hana, KEYBOARD), [403, 'not_seller']);
});

test('the list never includes withdrawn listings, whatever the filter', () => {
  const { service } = setup();
  service.withdraw(ken, KEYBOARD);
  assert.deepEqual(ids(service.list()), ['l5', 'l4', 'l2', 'l1']);
  assert.deepEqual(ids(service.list({ status: 'on_sale' })), ['l5', 'l2', 'l1']);
  assert.deepEqual(ids(service.list({ status: 'sold' })), ['l4']);
  assert.deepEqual(ids(service.list({ q: 'keyboard' })), []);
  assert.deepEqual(ids(service.list({ q: 'Mechanical' })), []);
  assert.deepEqual(ids(service.list({ status: 'on_sale', q: 'keyboard' })), []);
  assert.deepEqual(ids(service.list({ q: 'helmet' })), [HELMET]);
});

test('status=withdrawn is not a valid list filter', () => {
  const { service } = setup();
  service.withdraw(ken, KEYBOARD);
  for (const status of ['withdrawn', 'bogus']) {
    assertAppError(
      () => service.list({ status }),
      400,
      'invalid_status',
      'status must be one of: on_sale, sold.',
    );
  }
});

test('a withdrawn listing can still be read by its ID', () => {
  const { service } = setup();
  service.withdraw(ken, KEYBOARD);
  const listing = service.get(KEYBOARD);
  assert.deepEqual(
    [listing.status, listing.buyerId, listing.title, listing.priceYen],
    ['withdrawn', null, 'Mechanical keyboard', 7800],
  );
});

test('a withdrawn listing cannot be bought, and the seller still gets own_listing', () => {
  const { store, service } = setup();
  service.withdraw(ken, KEYBOARD);
  for (const user of [mio, hana]) {
    assertRejectedUnchanged(store, KEYBOARD, () => service.purchase(user, KEYBOARD), [
      409,
      'listing_withdrawn',
      WITHDRAWN_MESSAGE,
    ]);
  }
  assertRejectedUnchanged(store, KEYBOARD, () => service.purchase(ken, KEYBOARD), [409, 'own_listing']);
  assertAppError(() => service.purchase(hana, STOVE), 409, 'already_sold');
});

test('withdrawing keeps the order of the other listings and works on new ones', () => {
  const { service } = setup();
  const lamp = service.create(ken, { title: 'Desk lamp', description: '', priceYen: 1200 });
  assert.equal(service.list()[0].id, lamp.id);
  assert.equal(service.withdraw(ken, lamp.id).status, 'withdrawn');
  assert.deepEqual(ids(service.list()), ['l5', 'l4', 'l3', 'l2', 'l1']);
  assert.deepEqual(ids(service.list({ q: 'lamp' })), []);
});

test('withdrawing keeps the saves of the listing', () => {
  const store = createStore();
  const service = createListingService(store);
  const favorites = createFavoriteService(store);
  favorites.save(hana, KEYBOARD);
  favorites.save(mio, KEYBOARD);
  const withdrawn = favorites.decorate(service.withdraw(ken, KEYBOARD), ken);
  assert.deepEqual([withdrawn.savedCount, withdrawn.savedByMe], [2, false]);
  assert.equal(favorites.decorate(service.get(KEYBOARD), hana).savedByMe, true);
});
