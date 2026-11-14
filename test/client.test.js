import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyFavoriteResult,
  canFavorite,
  createLatestGate,
  listingsPath,
  optimisticFavorite,
} from '../public/favorites-state.js';

const helmet = { id: 'l2', title: 'Road bike helmet (M)', sellerId: 'u2', savedCount: 0, savedByMe: false };
const keyboard = { id: 'l3', title: 'Mechanical keyboard', sellerId: 'u2', savedCount: 2, savedByMe: true };

test('client: only the newest load ticket is current', () => {
  const gate = createLatestGate();
  const first = gate.next();
  assert.equal(gate.isCurrent(first), true);
  const second = gate.next();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  assert.equal(gate.current(), second);
});

test('client: All uses the filters, Saved ignores them', () => {
  assert.equal(listingsPath('all', { q: '', onSale: false }), '/api/listings?');
  assert.equal(listingsPath('all', { q: ' helmet ', onSale: true }), '/api/listings?q=helmet&status=on_sale');
  assert.equal(listingsPath('saved', { q: 'helmet', onSale: true }), '/api/me/favorites');
});

test("client: hearts only appear on other users' listings", () => {
  assert.equal(canFavorite(helmet, 'u1'), true);
  assert.equal(canFavorite(helmet, 'u2'), false);
});

test('client: an optimistic toggle flips the heart and moves the count by one', () => {
  assert.deepEqual(optimisticFavorite(helmet), { savedByMe: true, savedCount: 1 });
  assert.deepEqual(optimisticFavorite(keyboard), { savedByMe: false, savedCount: 1 });
  assert.deepEqual(optimisticFavorite({ ...keyboard, savedCount: 0 }), { savedByMe: false, savedCount: 0 });
});

test('client: a server result replaces the card in All and keeps unsaved cards', () => {
  const result = applyFavoriteResult(
    [helmet, keyboard],
    { ...keyboard, savedCount: 1, savedByMe: false },
    'all',
  );
  assert.deepEqual(
    result.map((l) => [l.id, l.savedCount, l.savedByMe]),
    [
      ['l2', 0, false],
      ['l3', 1, false],
    ],
  );
});

test('client: a removal in Saved drops the card, a save keeps it', () => {
  const removed = applyFavoriteResult(
    [keyboard, helmet],
    { ...keyboard, savedByMe: false, savedCount: 1 },
    'saved',
  );
  assert.deepEqual(
    removed.map((l) => l.id),
    ['l2'],
  );
  const saved = applyFavoriteResult([keyboard], { ...keyboard, savedCount: 3 }, 'saved');
  assert.deepEqual(
    saved.map((l) => [l.id, l.savedCount]),
    [['l3', 3]],
  );
});

test('client: a result for a listing that is not shown changes nothing', () => {
  const listings = [helmet];
  assert.deepEqual(applyFavoriteResult(listings, { ...keyboard, savedByMe: false }, 'all'), listings);
  assert.equal(applyFavoriteResult(null, keyboard, 'all'), null);
});
