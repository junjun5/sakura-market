import assert from 'node:assert/strict';

// Every listing in an API response has exactly these keys.
export const LISTING_KEYS = [
  'buyerId',
  'createdAt',
  'description',
  'id',
  'priceYen',
  'savedByMe',
  'savedCount',
  'sellerId',
  'status',
  'title',
  'updatedAt',
];

export function assertError(res, status, code) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body), ['error']);
  assert.deepEqual(Object.keys(res.body.error).sort(), ['code', 'message']);
  assert.equal(res.body.error.code, code);
  assert.match(res.body.error.code, /^[a-z]+(_[a-z]+)*$/);
  assert.ok(res.body.error.message.length > 0);
}
