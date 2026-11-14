#!/usr/bin/env node
// Flaky test detection: runs the whole suite several times and reports every
// test whose outcome changes between runs.
//   node scripts/flaky-tests.js [runs=5]
// Exits 1 if any test is flaky or fails in every run. Runs on a schedule in CI
// (.github/workflows/flaky-tests.yml); run it locally after touching timing-
// sensitive tests such as test/controller.test.js.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseJunit } from './lib/junit.js';

export const DEFAULT_RUNS = 5;

/**
 * @typedef {import('./lib/junit.js').TestResult} TestResult
 * @typedef {{ key: string, passed: number, failed: number }} Tally
 */

/**
 * Groups results from all runs by test and keeps the ones that did not pass every time.
 * @param {TestResult[][]} runs
 */
export function classify(runs) {
  /** @type {Map<string, Tally>} */
  const tallies = new Map();
  for (const results of runs) {
    for (const r of results) {
      if (r.outcome === 'skipped') continue;
      const key = `${r.file} > ${r.name}`;
      const tally = tallies.get(key) ?? { key, passed: 0, failed: 0 };
      if (r.outcome === 'passed') tally.passed += 1;
      else tally.failed += 1;
      tallies.set(key, tally);
    }
  }
  const all = [...tallies.values()];
  return {
    tests: all.length,
    flaky: all.filter((t) => t.passed > 0 && t.failed > 0),
    broken: all.filter((t) => t.passed === 0 && t.failed > 0),
  };
}

/** @param {number} runs */
function runSuite(runs) {
  const dir = mkdtempSync(join(tmpdir(), 'sakura-flaky-'));
  const testFiles = readdirSync('test')
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => join('test', f));
  try {
    return Array.from({ length: runs }, (_, i) => {
      const destination = join(dir, `run-${i + 1}.xml`);
      spawnSync(
        process.execPath,
        ['--test', '--test-reporter=junit', `--test-reporter-destination=${destination}`, ...testFiles],
        { stdio: 'ignore' },
      );
      if (!existsSync(destination))
        throw new Error(`Run ${i + 1} wrote no JUnit report; run npm test to see why.`);
      const results = parseJunit(readFileSync(destination, 'utf8'));
      console.log(`run ${i + 1}/${runs}: ${results.filter((r) => r.outcome === 'failed').length} failed`);
      return results;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const runs = Number(process.argv[2] ?? DEFAULT_RUNS);
  if (!Number.isInteger(runs) || runs < 2) {
    console.error('Usage: node scripts/flaky-tests.js [runs>=2]');
    process.exitCode = 2;
    return;
  }
  const { tests, flaky, broken } = classify(runSuite(runs));
  for (const t of flaky) console.log(`FLAKY  passed ${t.passed}/${runs}: ${t.key}`);
  for (const t of broken) console.log(`BROKEN failed ${t.failed}/${runs}: ${t.key}`);
  console.log(`${tests} tests x ${runs} runs: ${flaky.length} flaky, ${broken.length} always failing.`);
  if (flaky.length > 0 || broken.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
