import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { createFlags, FLAGS } from '../src/flags.js';

const DEFINITIONS = {
  new_search: { defaultEnabled: false, description: 'Test flag that starts off.' },
  old_banner: { defaultEnabled: true, description: 'Test flag that starts on.' },
};

test('flags start at their declared defaults', () => {
  const flags = createFlags('', DEFINITIONS);
  assert.equal(flags.isEnabled('new_search'), false);
  assert.equal(flags.isEnabled('old_banner'), true);
  assert.deepEqual(flags.list(), [
    { name: 'new_search', enabled: false },
    { name: 'old_banner', enabled: true },
  ]);
});

test('FEATURE_FLAGS turns flags on and off, case-insensitively and with spaces', () => {
  const flags = createFlags(' new_search = ON , old_banner=off ', DEFINITIONS);
  assert.equal(flags.isEnabled('new_search'), true);
  assert.equal(flags.isEnabled('old_banner'), false);

  for (const value of ['on', 'true', '1']) {
    assert.equal(createFlags(`new_search=${value}`, DEFINITIONS).isEnabled('new_search'), true);
  }
  for (const value of ['off', 'false', '0']) {
    assert.equal(createFlags(`old_banner=${value}`, DEFINITIONS).isEnabled('old_banner'), false);
  }
  assert.equal(createFlags('new_search', DEFINITIONS).isEnabled('new_search'), true);
  assert.equal(createFlags(',,', DEFINITIONS).isEnabled('old_banner'), true);
  assert.equal(createFlags(undefined, DEFINITIONS).isEnabled('new_search'), false);
});

test('unknown flag names fail loudly, in FEATURE_FLAGS and in code', () => {
  assert.throws(
    () => createFlags('new_serch=on', DEFINITIONS),
    /Unknown feature flag "new_serch" in FEATURE_FLAGS\. Known flags: new_search, old_banner\./,
  );
  assert.throws(() => createFlags('', DEFINITIONS).isEnabled('nope'), /Unknown feature flag "nope"/);
});

test('flag values other than on/off are rejected', () => {
  assert.throws(
    () => createFlags('new_search=maybe', DEFINITIONS),
    /must be on or off; got "new_search=maybe"/,
  );
  assert.throws(() => createFlags('new_search=on=off', DEFINITIONS), /must be on or off/);
});

test('every declared flag has a snake_case name, a default and a description', () => {
  for (const [name, flag] of Object.entries(FLAGS)) {
    assert.match(name, /^[a-z]+(_[a-z]+)*$/);
    assert.equal(typeof flag.defaultEnabled, 'boolean');
    assert.ok(flag.description.length > 0, name);
  }
  assert.equal(createFlags().isEnabled('metrics_endpoint'), true);
});

test('every declared flag is read somewhere in src/, so dead flags get removed', () => {
  const sources = readdirSync('src')
    .filter((file) => file.endsWith('.js') && file !== 'flags.js')
    .map((file) => readFileSync(join('src', file), 'utf8'))
    .join('\n');
  for (const name of Object.keys(FLAGS)) {
    assert.ok(sources.includes(`isEnabled('${name}')`), `flag ${name} is declared but never read`);
  }
});
