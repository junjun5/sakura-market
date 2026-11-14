import assert from 'node:assert/strict';

import { AppError } from '../../src/errors.js';

// Checks that `fn` throws an AppError with this status and code, and with
// `message` when one is given.
export function assertAppError(fn, status, code, message) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof AppError, `expected AppError, got ${err}`);
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    assert.ok(err.message.length > 0);
    if (message !== undefined) assert.equal(err.message, message);
    return true;
  });
}

// Runs `fn`, which must throw, and checks that the listing did not change.
// `expected` is [status, code] or [status, code, message].
export function assertRejectedUnchanged(store, id, fn, expected) {
  const before = structuredClone(store.getListing(id));
  assertAppError(fn, ...expected);
  assert.deepEqual(store.getListing(id), before);
}
