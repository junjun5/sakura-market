import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createListingService, MAX_TITLE_LENGTH, MIN_PRICE_YEN } from '../src/listings.js';
import { createStore } from '../src/store.js';
import { assertAppError } from './support/errors.js';

const hana = { id: 'u1', name: 'Hana' };
const ken = { id: 'u2', name: 'Ken' };

function setup() {
  const store = createStore();
  const service = createListingService(store, { now: () => new Date('2026-05-01T00:00:00.000Z') });
  return { store, service };
}

test('list returns newest first', () => {
  const { service } = setup();
  const ids = service.list().map((l) => l.id);
  assert.deepEqual(ids, ['l5', 'l4', 'l3', 'l2', 'l1']);
});

test('list filters by status and title', () => {
  const { service } = setup();
  assert.deepEqual(
    service.list({ status: 'sold' }).map((l) => l.id),
    ['l4'],
  );
  assert.deepEqual(
    service.list({ q: 'KEYBOARD' }).map((l) => l.id),
    ['l3'],
  );
  assertAppError(() => service.list({ status: 'archived' }), 400, 'invalid_status');
});

test('get throws 404 for an unknown listing', () => {
  const { service } = setup();
  assert.equal(service.get('l1').title, 'Film camera, 35mm');
  assertAppError(() => service.get('nope'), 404, 'listing_not_found');
});

test('create stores a new on-sale listing owned by the caller', () => {
  const { service } = setup();
  const listing = service.create(hana, { title: '  Desk lamp ', description: 'LED', priceYen: 2000 });
  assert.deepEqual(listing, {
    id: 'l6',
    title: 'Desk lamp',
    description: 'LED',
    priceYen: 2000,
    sellerId: 'u1',
    status: 'on_sale',
    buyerId: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: null,
  });
  assert.equal(service.list()[0].id, 'l6');
});

test('create validates title and price', () => {
  const { service } = setup();
  assertAppError(() => service.create(hana, { title: ' ', priceYen: 1000 }), 400, 'invalid_title');
  assertAppError(
    () => service.create(hana, { title: 'x'.repeat(MAX_TITLE_LENGTH + 1), priceYen: 1000 }),
    400,
    'invalid_title',
  );
  assertAppError(
    () => service.create(hana, { title: 'Lamp', priceYen: MIN_PRICE_YEN - 1 }),
    400,
    'invalid_price',
  );
  assertAppError(() => service.create(hana, { title: 'Lamp', priceYen: 1000.5 }), 400, 'invalid_price');
  assertAppError(() => service.create(hana, { title: 'Lamp', priceYen: '1000' }), 400, 'invalid_price');
});

test('purchase marks the listing as sold to the buyer', () => {
  const { service } = setup();
  const listing = service.purchase(hana, 'l2');
  assert.equal(listing.status, 'sold');
  assert.equal(listing.buyerId, 'u1');
});

test('purchase rejects own and already-sold listings', () => {
  const { service } = setup();
  assertAppError(() => service.purchase(ken, 'l2'), 409, 'own_listing');
  assertAppError(() => service.purchase(ken, 'l4'), 409, 'already_sold');
  assertAppError(() => service.purchase(ken, 'nope'), 404, 'listing_not_found');
});
