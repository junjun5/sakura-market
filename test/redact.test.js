import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_REDACT_DEPTH, REDACTED, redact, redactText } from '../src/redact.js';

test('redact masks credential keys at any depth, case-insensitively', () => {
  const out = redact({
    method: 'GET',
    headers: {
      'X-User-Id': 'u1',
      authorization: 'Bearer abc',
      Cookie: 'sid=1',
      'content-type': 'application/json',
    },
    body: { password: 'pw', passwd: 'pw', apiKey: 'k', api_key: 'k', nested: { sessionId: 's', token: 't' } },
  });
  assert.deepEqual(out, {
    method: 'GET',
    headers: {
      'X-User-Id': REDACTED,
      authorization: REDACTED,
      Cookie: REDACTED,
      'content-type': 'application/json',
    },
    body: {
      password: REDACTED,
      passwd: REDACTED,
      apiKey: REDACTED,
      api_key: REDACTED,
      nested: { sessionId: REDACTED, token: REDACTED },
    },
  });
});

test('redactText masks bearer/basic credentials and email addresses inside text', () => {
  assert.equal(
    redactText('call failed: Authorization: Bearer not-a-real-token for hana@example.com'),
    `call failed: Authorization: Bearer ${REDACTED} for ${REDACTED}`,
  );
  assert.equal(redactText('Basic dXNlcjpwYXNz, then more'), `Basic ${REDACTED}, then more`);
  assert.equal(redactText('listing l2 not found'), 'listing l2 not found');
});

test('redact scrubs strings inside objects and arrays', () => {
  assert.deepEqual(redact({ notes: ['mail ken@example.org', 'ok'] }), {
    notes: [`mail ${REDACTED}`, 'ok'],
  });
});

test('redact turns errors into plain objects with scrubbed message, stack, fields and cause', () => {
  const cause = new Error('upstream said Bearer not-a-real-token');
  const err = new Error('lookup failed for mio@example.com', { cause });
  err.code = 'lookup_failed';
  err.token = 'not-a-real-token';

  const out = redact(err);
  assert.equal(out.name, 'Error');
  assert.equal(out.message, `lookup failed for ${REDACTED}`);
  assert.match(out.stack, /lookup failed for \[redacted\]/);
  assert.doesNotMatch(out.stack, /mio@example\.com/);
  assert.equal(out.code, 'lookup_failed');
  assert.equal(out.token, REDACTED);
  assert.equal(out.cause.message, `upstream said Bearer ${REDACTED}`);
  assert.doesNotMatch(JSON.stringify(out), /not-a-real-token|mio@example\.com/);
});

test('redact keeps primitives and does not modify its input', () => {
  for (const value of [42, true, null, undefined, 0n]) assert.equal(redact(value), value);

  const input = { headers: { 'x-user-id': 'u1' }, list: ['hana@example.com'] };
  const copy = structuredClone(input);
  redact(input);
  assert.deepEqual(input, copy);
});

test('redact marks cycles but not shared references, and cuts off deep nesting', () => {
  const shared = { id: 'l1' };
  const looped = { a: shared, b: shared };
  looped.self = looped;
  assert.deepEqual(redact(looped), { a: { id: 'l1' }, b: { id: 'l1' }, self: '[circular]' });

  let deep = { leaf: true };
  for (let i = 0; i < MAX_REDACT_DEPTH + 2; i++) deep = { next: deep };
  let node = redact(deep);
  for (let i = 0; i < MAX_REDACT_DEPTH; i++) node = node.next;
  assert.equal(node, '[truncated]');
});
