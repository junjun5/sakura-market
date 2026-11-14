import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classify } from '../scripts/flaky-tests.js';
import { parseJunit } from '../scripts/lib/junit.js';
import { DEFAULT_SUITE_BUDGET_MS, summarize, toMarkdown } from '../scripts/timing-report.js';

const JUNIT = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testcase name="fast &amp; &quot;quoted&quot;" time="0.001500" classname="test" file="/repo/test/a.test.js"/>
  <testcase name="slow" time="2.5" classname="test" file="/repo/test/a.test.js">
  </testcase>
  <testcase name="broken" time="0.01" classname="test" file="/repo/test/b.test.js">
    <failure type="testCodeFailure" message="boom">boom</failure>
  </testcase>
  <testcase name="later" time="0" classname="test" file="/repo/test/b.test.js">
    <skipped type="skipped" message="todo"/>
  </testcase>
</testsuites>`;

/**
 * @param {string} name
 * @param {'passed' | 'failed' | 'skipped'} outcome
 */
const result = (name, outcome) => ({ name, file: 'test/x.test.js', durationMs: 1, outcome });

test('parseJunit reads name, file, duration and outcome of every test case', () => {
  assert.deepEqual(parseJunit(JUNIT), [
    { name: 'fast & "quoted"', file: '/repo/test/a.test.js', durationMs: 1.5, outcome: 'passed' },
    { name: 'slow', file: '/repo/test/a.test.js', durationMs: 2500, outcome: 'passed' },
    { name: 'broken', file: '/repo/test/b.test.js', durationMs: 10, outcome: 'failed' },
    { name: 'later', file: '/repo/test/b.test.js', durationMs: 0, outcome: 'skipped' },
  ]);
  assert.deepEqual(parseJunit('<testsuites></testsuites>'), []);
});

test('the timing summary lists the slowest tests and flags budget overruns', () => {
  const summary = summarize(parseJunit(JUNIT), { slowest: 2, testBudgetMs: 2000, suiteBudgetMs: 1000 });
  assert.equal(summary.count, 4);
  assert.equal(summary.failed, 1);
  assert.equal(summary.totalMs, 2511.5);
  assert.deepEqual(
    summary.slowest.map((r) => r.name),
    ['slow', 'broken'],
  );
  assert.deepEqual(
    summary.overBudget.map((r) => r.name),
    ['slow'],
  );
  assert.equal(summary.suiteOverBudget, true);
  assert.equal(summarize([]).suiteOverBudget, false);
  assert.equal(summarize([]).suiteBudgetMs, DEFAULT_SUITE_BUDGET_MS);
});

test('the timing report is a Markdown table with pipes and backslashes in names escaped', () => {
  const markdown = toMarkdown(summarize([{ ...result('a | b', 'passed'), durationMs: 12.34 }]));
  assert.match(markdown, /^## Test timing\n/);
  assert.match(markdown, /1 tests, 0 failed, 0\.01 s of test time/);
  assert.match(markdown, /\| 12\.3 \| a \\\| b \| test\/x\.test\.js \|/);
  assert.match(toMarkdown(summarize([result('a \\| b', 'passed')])), /\| a \\\\\\\| b \|/);
});

test('flaky detection separates flaky, always-failing and skipped tests', () => {
  const runs = [
    [
      result('stable', 'passed'),
      result('flaky', 'passed'),
      result('broken', 'failed'),
      result('todo', 'skipped'),
    ],
    [
      result('stable', 'passed'),
      result('flaky', 'failed'),
      result('broken', 'failed'),
      result('todo', 'skipped'),
    ],
  ];
  const { tests, flaky, broken } = classify(runs);
  assert.equal(tests, 3);
  assert.deepEqual(flaky, [{ key: 'test/x.test.js > flaky', passed: 1, failed: 1 }]);
  assert.deepEqual(broken, [{ key: 'test/x.test.js > broken', passed: 0, failed: 2 }]);
});
