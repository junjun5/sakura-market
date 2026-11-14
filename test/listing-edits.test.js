import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError, forbidden } from '../src/errors.js';
import {
  createListingService,
  EDITABLE_FIELDS,
  MAX_DESCRIPTION_LENGTH,
  MAX_PRICE_YEN,
  MAX_TITLE_LENGTH,
  MIN_PRICE_YEN,
  STATUSES,
} from '../src/listings.js';
import { createStore } from '../src/store.js';
import { assertAppError, assertRejectedUnchanged } from './support/errors.js';

const hana = { id: 'u1', name: 'Hana' };
const ken = { id: 'u2', name: 'Ken' };
const mio = { id: 'u3', name: 'Mio' };

// Seed data: l2 and l3 are Ken's on-sale helmet and keyboard, l4 is Mio's sold stove.
const HELMET = 'l2';
const STOVE = 'l4';

const TITLE_REQUIRED = 'title is required.';
const TITLE_TOO_LONG = 'title must be 80 characters or fewer.';
const DESCRIPTION_TOO_LONG = 'description must be 1000 characters or fewer.';
const PRICE_INVALID = 'priceYen must be an integer between 300 and 9999999.';

// A clock that moves forward one second on every read.
function setup({ store = createStore() } = {}) {
  let ms = Date.parse('2026-05-01T00:00:00.000Z');
  const now = () => {
    const at = new Date(ms);
    ms += 1000;
    return at;
  };
  return { store, service: createListingService(store, { now }) };
}

test('forbidden() makes a 403 AppError', () => {
  const err = forbidden('not_seller', 'No.');
  assert.ok(err instanceof AppError);
  assert.deepEqual([err.status, err.code, err.message], [403, 'not_seller', 'No.']);
});

test('the editable fields are title, description and priceYen', () => {
  assert.deepEqual(EDITABLE_FIELDS, ['title', 'description', 'priceYen']);
});

test('seed and new listings start with updatedAt null', () => {
  const { service } = setup();
  assert.ok(service.list().every((l) => l.updatedAt === null));
  assert.equal(service.create(hana, { title: 'Lamp', priceYen: 1000 }).updatedAt, null);
});

test('edit changes only the fields it is given and records updatedAt', () => {
  const { store, service } = setup();
  const before = store.getListing(HELMET);

  const priced = service.edit(ken, HELMET, { priceYen: 3900 });
  assert.deepEqual(priced, { ...before, priceYen: 3900, updatedAt: '2026-05-01T00:00:00.000Z' });
  assert.deepEqual(store.getListing(HELMET), priced);

  const described = service.edit(ken, HELMET, { description: 'Includes spare pads.' });
  assert.equal(described.description, 'Includes spare pads.');
  assert.equal(described.title, before.title);
  assert.equal(described.priceYen, 3900);
  assert.equal(described.updatedAt, '2026-05-01T00:00:01.000Z');
  assert.equal(described.createdAt, before.createdAt);

  const titled = service.edit(ken, HELMET, { title: 'Helmet' });
  assert.deepEqual(
    [titled.title, titled.description, titled.priceYen],
    ['Helmet', 'Includes spare pads.', 3900],
  );

  const all = service.edit(ken, HELMET, { title: 'Helmet M', description: 'Like new.', priceYen: 3000 });
  assert.deepEqual([all.title, all.description, all.priceYen], ['Helmet M', 'Like new.', 3000]);
  assert.equal(all.updatedAt, '2026-05-01T00:00:03.000Z');
});

test('edit trims title and description like create', () => {
  const { service } = setup();
  const listing = service.edit(ken, HELMET, { title: '  Helmet M  ', description: '  Like new.  ' });
  assert.equal(listing.title, 'Helmet M');
  assert.equal(listing.description, 'Like new.');
});

test('edit accepts the boundary values', () => {
  const { service } = setup();
  const t80 = 'b'.repeat(MAX_TITLE_LENGTH);
  assert.equal(service.edit(ken, HELMET, { title: t80 }).title, t80);
  const c80 = 'c'.repeat(MAX_TITLE_LENGTH);
  assert.equal(service.edit(ken, HELMET, { title: `  ${c80}  ` }).title, c80);
  const d1000 = 'e'.repeat(MAX_DESCRIPTION_LENGTH);
  assert.equal(service.edit(ken, HELMET, { description: d1000 }).description, d1000);
  assert.equal(service.edit(ken, HELMET, { description: '' }).description, '');
  assert.equal(service.edit(ken, HELMET, { priceYen: MIN_PRICE_YEN }).priceYen, MIN_PRICE_YEN);
  assert.equal(service.edit(ken, HELMET, { priceYen: MAX_PRICE_YEN }).priceYen, MAX_PRICE_YEN);
});

test('edit rejects invalid values with the create messages and changes nothing', () => {
  const { store, service } = setup();
  const cases = [
    [{ title: '' }, 'invalid_title', TITLE_REQUIRED],
    [{ title: '   ' }, 'invalid_title', TITLE_REQUIRED],
    [{ title: 42 }, 'invalid_title', TITLE_REQUIRED],
    [{ title: 'a'.repeat(MAX_TITLE_LENGTH + 1) }, 'invalid_title', TITLE_TOO_LONG],
    [{ description: 'd'.repeat(MAX_DESCRIPTION_LENGTH + 1) }, 'invalid_description', DESCRIPTION_TOO_LONG],
    [{ priceYen: MIN_PRICE_YEN - 1 }, 'invalid_price', PRICE_INVALID],
    [{ priceYen: 100 }, 'invalid_price', PRICE_INVALID],
    [{ priceYen: MAX_PRICE_YEN + 1 }, 'invalid_price', PRICE_INVALID],
    [{ priceYen: 3900.5 }, 'invalid_price', PRICE_INVALID],
    [{ priceYen: '3900' }, 'invalid_price', PRICE_INVALID],
    [{ priceYen: null }, 'invalid_price', PRICE_INVALID],
  ];
  for (const [input, code, message] of cases) {
    assertRejectedUnchanged(store, HELMET, () => service.edit(ken, HELMET, input), [400, code, message]);
  }
  assert.equal(store.getListing(HELMET).updatedAt, null);
});

test('create keeps its messages after sharing the validators with edit', () => {
  const { service } = setup();
  assertAppError(() => service.create(hana, { priceYen: 1000 }), 400, 'invalid_title', TITLE_REQUIRED);
  assertAppError(
    () => service.create(hana, { title: 'x'.repeat(81), priceYen: 1000 }),
    400,
    'invalid_title',
    TITLE_TOO_LONG,
  );
  assertAppError(
    () => service.create(hana, { title: 'Lamp', description: 'x'.repeat(1001), priceYen: 1 }),
    400,
    'invalid_description',
    DESCRIPTION_TOO_LONG,
  );
  assertAppError(() => service.create(hana, { title: 'Lamp' }), 400, 'invalid_price', PRICE_INVALID);
});

test('a mix of valid and invalid fields changes nothing', () => {
  const { store, service } = setup();
  assertRejectedUnchanged(
    store,
    HELMET,
    () => service.edit(ken, HELMET, { title: 'New helmet title', description: 'New text', priceYen: 100 }),
    [400, 'invalid_price'],
  );
  assertRejectedUnchanged(store, HELMET, () => service.edit(ken, HELMET, { title: '', priceYen: 3900 }), [
    400,
    'invalid_title',
  ]);
  assertRejectedUnchanged(
    store,
    HELMET,
    () => service.edit(ken, HELMET, { priceYen: 3900, description: 'd'.repeat(1001) }),
    [400, 'invalid_description'],
  );
});

test('a body without any editable field is rejected with no_changes', () => {
  const { store, service } = setup();
  for (const input of [{}, { foo: 1 }, { status: 'withdrawn' }, [], 'text', 42, null, undefined]) {
    assertRejectedUnchanged(store, HELMET, () => service.edit(ken, HELMET, input), [
      400,
      'no_changes',
      'Provide at least one of title, description or priceYen.',
    ]);
  }
});

test('fields that cannot be edited are ignored', () => {
  const { store, service } = setup();
  const before = store.getListing(HELMET);
  const listing = service.edit(ken, HELMET, {
    priceYen: 4000,
    status: 'sold',
    sellerId: 'u1',
    buyerId: 'u3',
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    id: 'l99',
  });
  assert.deepEqual(listing, { ...before, priceYen: 4000, updatedAt: '2026-05-01T00:00:00.000Z' });
  assert.equal(store.getListing('l99'), null);
});

test('edit checks existence, then the seller, then the status, then the body', () => {
  const withdrawn = { ...createStore().getListing('l3'), id: 'w1', status: 'withdrawn' };
  const { store, service } = setup({
    store: createStore({ listings: [...createStore().listListings(), withdrawn] }),
  });
  assertAppError(
    () => service.edit(ken, 'l999', {}),
    404,
    'listing_not_found',
    'Listing l999 does not exist.',
  );
  for (const user of [hana, mio]) {
    assertRejectedUnchanged(store, HELMET, () => service.edit(user, HELMET, {}), [
      403,
      'not_seller',
      'Only the seller can change this listing.',
    ]);
  }
  assertRejectedUnchanged(store, STOVE, () => service.edit(ken, STOVE, { priceYen: 3000 }), [
    403,
    'not_seller',
  ]);
  for (const input of [{ priceYen: 3000 }, {}, { priceYen: 1 }]) {
    assertRejectedUnchanged(store, STOVE, () => service.edit(mio, STOVE, input), [
      409,
      'already_sold',
      'This listing has already been sold.',
    ]);
    assertRejectedUnchanged(store, 'w1', () => service.edit(ken, 'w1', input), [
      409,
      'listing_withdrawn',
      'This listing has been withdrawn.',
    ]);
  }
});

test('only on-sale listings can be edited', () => {
  for (const status of STATUSES.filter((s) => s !== 'on_sale')) {
    const listing = { ...createStore().getListing(HELMET), status };
    const { service } = setup({ store: createStore({ listings: [listing] }) });
    assert.throws(() => service.edit(ken, HELMET, { priceYen: 3900 }), { status: 409 });
  }
});

test('edits keep the order of the list', () => {
  const { service } = setup();
  service.edit(ken, HELMET, { title: 'Zzz helmet', priceYen: 3900 });
  service.edit(ken, 'l3', { title: 'Aaa keyboard' });
  assert.deepEqual(
    service.list().map((l) => l.id),
    ['l5', 'l4', 'l3', 'l2', 'l1'],
  );
});
