#!/usr/bin/env node
// Test timing report from a JUnit file: totals, the slowest tests, and a check
// that keeps the suite fast enough for agents to run it on every change.
//   node scripts/timing-report.js reports/junit.xml [--slowest=10] [--test-budget-ms=2000] [--suite-budget-ms=30000]
// Tests slower than the per-test budget are reported as warnings; the summed
// test time above the suite budget fails. With GITHUB_STEP_SUMMARY set (in CI),
// the report is also added to the job summary.
import { appendFileSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseJunit } from './lib/junit.js';

export const DEFAULT_TEST_BUDGET_MS = 2000;
export const DEFAULT_SUITE_BUDGET_MS = 30000;

/** @typedef {import('./lib/junit.js').TestResult} TestResult */

/**
 * @param {TestResult[]} results
 * @param {{ slowest?: number, testBudgetMs?: number, suiteBudgetMs?: number }} [options]
 */
export function summarize(
  results,
  { slowest = 10, testBudgetMs = DEFAULT_TEST_BUDGET_MS, suiteBudgetMs = DEFAULT_SUITE_BUDGET_MS } = {},
) {
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const byDuration = [...results].sort((a, b) => b.durationMs - a.durationMs);
  return {
    count: results.length,
    failed: results.filter((r) => r.outcome === 'failed').length,
    totalMs,
    slowest: byDuration.slice(0, slowest),
    overBudget: byDuration.filter((r) => r.durationMs > testBudgetMs),
    suiteOverBudget: totalMs > suiteBudgetMs,
    testBudgetMs,
    suiteBudgetMs,
  };
}

/** @param {ReturnType<typeof summarize>} summary */
export function toMarkdown(summary) {
  const rows = summary.slowest.map(
    (r) =>
      `| ${r.durationMs.toFixed(1)} | ${escapeCell(r.name)} | ${escapeCell(relative(process.cwd(), r.file))} |`,
  );
  return [
    '## Test timing',
    '',
    `${summary.count} tests, ${summary.failed} failed, ${(summary.totalMs / 1000).toFixed(2)} s of test time ` +
      `(suite budget ${summary.suiteBudgetMs / 1000} s, per-test budget ${summary.testBudgetMs} ms).`,
    '',
    '| ms | Slowest tests | File |',
    '| ---: | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

/** @param {string} text */
const escapeCell = (text) => text.replace(/\|/g, '\\|');

/**
 * @param {string[]} args
 * @param {string} name
 * @param {number} fallback
 */
function numberOption(args, name, fallback) {
  const raw = args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return raw === undefined ? fallback : Number(raw);
}

function main() {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    console.error(
      'Usage: node scripts/timing-report.js <junit.xml>... [--slowest=N] [--test-budget-ms=N] [--suite-budget-ms=N]',
    );
    process.exitCode = 2;
    return;
  }
  const results = files.flatMap((file) => parseJunit(readFileSync(file, 'utf8')));
  const summary = summarize(results, {
    slowest: numberOption(args, 'slowest', 10),
    testBudgetMs: numberOption(args, 'test-budget-ms', DEFAULT_TEST_BUDGET_MS),
    suiteBudgetMs: numberOption(args, 'suite-budget-ms', DEFAULT_SUITE_BUDGET_MS),
  });
  const markdown = toMarkdown(summary);
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);

  for (const r of summary.overBudget) {
    console.log(
      `::warning file=${relative(process.cwd(), r.file)}::Slow test (${r.durationMs.toFixed(0)} ms): ${r.name}`,
    );
  }
  if (summary.suiteOverBudget) {
    console.error(
      `Test time ${summary.totalMs.toFixed(0)} ms is over the ${summary.suiteBudgetMs} ms suite budget.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
