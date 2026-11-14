#!/usr/bin/env node
// Repository hygiene checks that no linter covers, run by `npm run check`:
//   - file size: every tracked file stays under MAX_FILE_BYTES (generated
//     lockfiles are allowed up to MAX_LOCKFILE_BYTES);
//   - tech debt markers (MARKERS below) must name a GitHub issue right after the
//     marker, as in "<marker>(#123): ...", so every piece of known debt is tracked;
//     Markdown may mention a bare marker inside `code`;
//   - test naming: tests are test/<topic>.test.js, helpers live in test/support/.
// `--debt` lists every tracked debt marker instead of checking.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_LOCKFILE_BYTES = 2 * 1024 * 1024;
const LOCKFILES = new Set(['package-lock.json']);
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.md', '.yml', '.yaml', '.sh', '.html', '.css', '.tsv', '']);
// Split so this file does not match its own rule.
const MARKERS = ['TO' + 'DO', 'FIX' + 'ME', 'HA' + 'CK', 'X' + 'XX'];
const MARKER_PATTERN = new RegExp(`\\b(${MARKERS.join('|')})\\b(\\(#\\d+\\))?`, 'g');
const TEST_FILE = /^test\/[a-z0-9]+(-[a-z0-9]+)*\.test\.js$/;
const TEST_SUPPORT = /^test\/support\/[^/]+\.js$/;

/**
 * @typedef {{ file: string, line: number, marker: string, issue: string | null, text: string }} DebtMarker
 * @typedef {{ file: string, problem: string }} Finding
 */

/**
 * @param {string[]} files
 * @param {(file: string) => number} sizeOf
 * @returns {Finding[]}
 */
export function findOversizedFiles(files, sizeOf) {
  return files.flatMap((file) => {
    const limit = LOCKFILES.has(file) ? MAX_LOCKFILE_BYTES : MAX_FILE_BYTES;
    const size = sizeOf(file);
    return size > limit ? [{ file, problem: `is ${size} bytes; the limit is ${limit}.` }] : [];
  });
}

/**
 * @param {string} file
 * @param {string} content
 * @returns {DebtMarker[]}
 */
export function findDebtMarkers(file, content) {
  return content.split('\n').flatMap((text, index) =>
    [...searchableText(file, text).matchAll(MARKER_PATTERN)].map((match) => ({
      file,
      line: index + 1,
      marker: match[1],
      issue: match[2] ? match[2].slice(2, -1) : null,
      text: text.trim(),
    })),
  );
}

/**
 * @param {string} file
 * @param {string} line
 */
function searchableText(file, line) {
  return extname(file) === '.md' ? line.replace(/`[^`]*`/g, '') : line;
}

/**
 * @param {DebtMarker[]} markers
 * @returns {Finding[]}
 */
export function untrackedDebt(markers) {
  return markers
    .filter((m) => m.issue === null)
    .map((m) => ({
      file: `${m.file}:${m.line}`,
      problem: `${m.marker} must link an issue, as in ${m.marker}(#123): ...`,
    }));
}

/**
 * @param {string[]} files
 * @returns {Finding[]}
 */
export function findMisnamedTests(files) {
  return files.flatMap((file) => {
    if (file.startsWith('test/')) {
      if (TEST_FILE.test(file) || TEST_SUPPORT.test(file) || !file.endsWith('.js')) return [];
      return [
        { file, problem: 'is not a test: name tests test/<topic>.test.js and put helpers in test/support/.' },
      ];
    }
    if (/\.(test|spec)\.js$/.test(file)) {
      return [{ file, problem: 'is a test outside test/; npm test only runs test/*.test.js.' }];
    }
    return [];
  });
}

/** @param {string} file */
const isText = (file) => TEXT_EXTENSIONS.has(extname(file)) && !LOCKFILES.has(file);

function listRepoFiles() {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  });
  return output.split('\0').filter((file) => file && statSafe(file));
}

/** @param {string} file */
function statSafe(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false; // deleted in the working tree but still in the index
  }
}

/** @param {string[]} files */
function collectDebt(files) {
  return files.filter(isText).flatMap((file) => findDebtMarkers(file, readFileSync(file, 'utf8')));
}

function main() {
  const files = listRepoFiles();
  const debt = collectDebt(files);

  if (process.argv.includes('--debt')) {
    for (const m of debt)
      console.log(`${m.file}:${m.line}\t${m.marker}\t${m.issue ? `#${m.issue}` : 'no issue'}\t${m.text}`);
    console.log(`${debt.length} tech debt marker(s).`);
    return;
  }

  const findings = [
    ...findOversizedFiles(files, (file) => statSync(file).size),
    ...untrackedDebt(debt),
    ...findMisnamedTests(files),
  ];
  for (const { file, problem } of findings) console.error(`${file} ${problem}`);
  if (findings.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `repo-checks: ${files.length} files OK (size, debt markers, test names); ${debt.length} tracked debt marker(s).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
