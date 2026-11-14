import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  findDebtMarkers,
  findMisnamedTests,
  findOversizedFiles,
  MAX_FILE_BYTES,
  MAX_LOCKFILE_BYTES,
  untrackedDebt,
} from '../scripts/repo-checks.js';

// Built from parts so this file does not trip the check it tests.
const TODO_MARK = 'TO' + 'DO';
const FIXME_MARK = 'FIX' + 'ME';

test('files over the size limit are reported; the lockfile gets a larger limit', () => {
  const sizes = {
    'src/app.js': MAX_FILE_BYTES,
    'docs/huge.md': MAX_FILE_BYTES + 1,
    'package-lock.json': MAX_LOCKFILE_BYTES,
  };
  const findings = findOversizedFiles(
    Object.keys(sizes),
    (file) => sizes[/** @type {keyof typeof sizes} */ (file)],
  );
  assert.deepEqual(findings, [
    { file: 'docs/huge.md', problem: `is ${MAX_FILE_BYTES + 1} bytes; the limit is ${MAX_FILE_BYTES}.` },
  ]);
  assert.equal(findOversizedFiles(['package-lock.json'], () => MAX_LOCKFILE_BYTES + 1).length, 1);
});

test('debt markers are found with the issue they link, if any', () => {
  const content = [`// ${TODO_MARK}(#12): paginate`, 'const ok = 1;', `// ${FIXME_MARK} race on reload`].join(
    '\n',
  );
  assert.deepEqual(findDebtMarkers('src/x.js', content), [
    { file: 'src/x.js', line: 1, marker: TODO_MARK, issue: '12', text: `// ${TODO_MARK}(#12): paginate` },
    { file: 'src/x.js', line: 3, marker: FIXME_MARK, issue: null, text: `// ${FIXME_MARK} race on reload` },
  ]);
});

test('markers inside words or Markdown code spans do not count', () => {
  assert.deepEqual(findDebtMarkers('src/x.js', `const ${TODO_MARK}LIST = 1;`), []);
  assert.deepEqual(findDebtMarkers('AGENTS.md', `Write \`${TODO_MARK}(#123)\` markers.`), []);
  assert.equal(findDebtMarkers('src/x.js', `// \`${TODO_MARK}\` here`).length, 1);
});

test('only markers without an issue are untracked debt', () => {
  const markers = findDebtMarkers('src/x.js', `// ${TODO_MARK}(#1) a\n// ${TODO_MARK} b`);
  assert.deepEqual(untrackedDebt(markers), [
    { file: 'src/x.js:2', problem: `${TODO_MARK} must link an issue, as in ${TODO_MARK}(#123): ...` },
  ]);
});

test('tests must be test/<topic>.test.js, helpers test/support/*.js', () => {
  const files = [
    'test/api.test.js',
    'test/repo-checks.test.js',
    'test/support/server.js',
    'test/fixtures.json',
    'test/helpers.js',
    'test/Api.test.js',
    'test/nested/deep.test.js',
    'src/app.spec.js',
    'src/app.js',
  ];
  assert.deepEqual(
    findMisnamedTests(files).map((f) => f.file),
    ['test/helpers.js', 'test/Api.test.js', 'test/nested/deep.test.js', 'src/app.spec.js'],
  );
});
