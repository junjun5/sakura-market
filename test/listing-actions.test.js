import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  actionFor,
  canManage,
  draftFrom,
  editBody,
  isEditField,
  replaceListing,
  withoutListing,
} from '../public/listing-actions.js';

const helmet = {
  id: 'l2',
  title: 'Road bike helmet (M)',
  description: 'Size M, used one season.',
  priceYen: 4500,
  sellerId: 'u2',
  status: 'on_sale',
};
const keyboard = { ...helmet, id: 'l3', title: 'Mechanical keyboard', priceYen: 7800 };

test('listing actions: only the seller manages their own on-sale listing', () => {
  assert.equal(canManage(helmet, 'u2'), true);
  assert.equal(canManage(helmet, 'u1'), false);
  assert.equal(canManage({ ...helmet, status: 'sold' }, 'u2'), false);
  assert.equal(canManage({ ...helmet, status: 'withdrawn' }, 'u2'), false);
});

test('listing actions: the action button never offers Buy on a sold or withdrawn listing', () => {
  assert.deepEqual(actionFor(helmet, 'u1'), { label: 'Buy', enabled: true });
  assert.deepEqual(actionFor(helmet, 'u2'), { label: 'Your listing', enabled: false });
  assert.deepEqual(actionFor({ ...helmet, status: 'sold' }, 'u1'), { label: 'Sold', enabled: false });
  assert.deepEqual(actionFor({ ...helmet, status: 'sold' }, 'u2'), { label: 'Sold', enabled: false });
  assert.deepEqual(actionFor({ ...helmet, status: 'withdrawn' }, 'u1'), {
    label: 'Withdrawn',
    enabled: false,
  });
  assert.deepEqual(actionFor({ ...helmet, status: 'withdrawn' }, 'u2'), {
    label: 'Withdrawn',
    enabled: false,
  });
});

test('listing actions: a draft starts from the current values with the price as text', () => {
  assert.deepEqual(draftFrom(helmet), {
    title: 'Road bike helmet (M)',
    description: 'Size M, used one season.',
    priceYen: '4500',
    saving: false,
  });
});

test('listing actions: the edit body sends all three fields as typed', () => {
  const draft = { title: ' New title ', description: '', priceYen: '3900', saving: true };
  assert.deepEqual(editBody(draft), { title: ' New title ', description: '', priceYen: 3900 });
  assert.equal(editBody({ ...draft, priceYen: '' }).priceYen, 0);
  assert.equal(JSON.stringify(editBody({ ...draft, priceYen: 'abc' }).priceYen), 'null');
});

test('listing actions: only title, description and priceYen are draft fields', () => {
  assert.equal(isEditField('title'), true);
  assert.equal(isEditField('description'), true);
  assert.equal(isEditField('priceYen'), true);
  assert.equal(isEditField('status'), false);
  assert.equal(isEditField('saving'), false);
});

test('listing actions: an edited listing replaces its card in place', () => {
  const updated = { ...helmet, priceYen: 3900, updatedAt: '2026-11-14T00:00:00.000Z' };
  const result = replaceListing([keyboard, helmet], updated);
  assert.deepEqual(
    result.map((l) => [l.id, l.priceYen]),
    [
      ['l3', 7800],
      ['l2', 3900],
    ],
  );
  assert.equal(result[1].updatedAt, '2026-11-14T00:00:00.000Z');
  assert.equal(replaceListing(null, updated), null);
  const listings = [keyboard];
  assert.equal(replaceListing(listings, updated), listings);
});

test('listing actions: a withdrawn listing leaves the shown listings', () => {
  assert.deepEqual(
    withoutListing([keyboard, helmet], 'l2').map((l) => l.id),
    ['l3'],
  );
  assert.equal(withoutListing(null, 'l2'), null);
  const listings = [keyboard];
  assert.equal(withoutListing(listings, 'l2'), listings);
});
