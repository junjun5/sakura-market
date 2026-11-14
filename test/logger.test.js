import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLogger, LOG_LEVELS } from '../src/logger.js';
import { REDACTED } from '../src/redact.js';

const FIXED_TIME = new Date('2026-05-01T00:00:00.000Z');

function capture(options = {}) {
  const lines = [];
  const logger = createLogger({
    now: () => FIXED_TIME,
    write: (line, severity) => lines.push({ entry: JSON.parse(line), severity }),
    ...options,
  });
  return { logger, lines };
}

test('logger writes one JSON object per line with time, level, msg and fields', () => {
  const { logger, lines } = capture();
  logger.info('request', { method: 'GET', status: 200 });
  assert.deepEqual(lines, [
    {
      entry: { time: '2026-05-01T00:00:00.000Z', level: 'info', msg: 'request', method: 'GET', status: 200 },
      severity: 'info',
    },
  ]);
});

test('logger drops entries below the configured level', () => {
  const { logger, lines } = capture({ level: 'warn' });
  logger.debug('a');
  logger.info('b');
  logger.warn('c');
  logger.error('d');
  assert.deepEqual(
    lines.map((l) => [l.entry.msg, l.severity]),
    [
      ['c', 'warn'],
      ['d', 'error'],
    ],
  );

  const silent = capture({ level: 'silent' });
  for (const level of ['debug', 'info', 'warn', 'error']) silent.logger[level]('x');
  assert.deepEqual(silent.lines, []);
});

test('logger rejects an unknown level with the list of valid ones', () => {
  assert.deepEqual(LOG_LEVELS, ['debug', 'info', 'warn', 'error', 'silent']);
  assert.throws(() => createLogger({ level: 'verbose' }), /LOG_LEVEL must be one of debug, info.*"verbose"/);
});

test('logger redacts credentials, emails and errors in every field', () => {
  const { logger, lines } = capture();
  logger.error('unhandled_error', {
    headers: { 'x-user-id': 'u1', authorization: 'Bearer not-a-real-token' },
    error: new Error('lookup failed for hana@example.com'),
  });
  const { entry } = lines[0];
  assert.equal(entry.headers['x-user-id'], REDACTED);
  assert.equal(entry.headers.authorization, REDACTED);
  assert.equal(entry.error.name, 'Error');
  assert.equal(entry.error.message, `lookup failed for ${REDACTED}`);
  assert.doesNotMatch(JSON.stringify(lines), /hana@example\.com|not-a-real-token/);
});

test('logger children add fixed fields, and call fields win over them', () => {
  const { logger, lines } = capture();
  const child = logger.child({ requestId: 'req-1', component: 'app' });
  child.info('step', { component: 'store' });
  assert.equal(lines[0].entry.requestId, 'req-1');
  assert.equal(lines[0].entry.component, 'store');
});

test('logger serialises bigint values instead of throwing', () => {
  const { logger, lines } = capture();
  logger.info('big', { count: 12n });
  assert.equal(lines[0].entry.count, '12');
});
