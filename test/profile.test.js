import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { percentile, REQUEST_MIX } from '../scripts/profile.js';

test('percentile picks the nearest-rank value', () => {
  const values = [5, 1, 4, 2, 3];
  assert.equal(percentile(values, 0.5), 3);
  assert.equal(percentile(values, 0.95), 5);
  assert.equal(percentile(values, 1), 5);
  assert.equal(percentile(values, 0), 1);
  assert.equal(percentile([], 0.5), 0);
  assert.deepEqual(values, [5, 1, 4, 2, 3]);
});

test('every profiled request is a documented route', () => {
  const spec = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
  const documented = new Set(
    Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.keys(/** @type {object} */ (item)).map(
        (method) => `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`,
      ),
    ),
  );
  for (const [label, method] of REQUEST_MIX) {
    const route = label.replace(/\?.*$/, '');
    assert.ok(documented.has(route), `${label} is not in openapi.json`);
    assert.ok(route.startsWith(`${method} `), label);
  }
});
