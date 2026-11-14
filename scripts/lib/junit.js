// Reads the JUnit XML that `node --test --test-reporter=junit` writes. Only the
// parts the reporting scripts need: one entry per <testcase>.

/**
 * @typedef {'passed' | 'failed' | 'skipped'} Outcome
 * @typedef {{ name: string, file: string, durationMs: number, outcome: Outcome }} TestResult
 */

const TESTCASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const ATTRIBUTE = /([\w:-]+)="([^"]*)"/g;
/** @type {Record<string, string>} */
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };

/**
 * @param {string} xml
 * @returns {TestResult[]}
 */
export function parseJunit(xml) {
  return [...xml.matchAll(TESTCASE)].map(([, rawAttributes, body = '']) => {
    const attributes = Object.fromEntries(
      [...rawAttributes.matchAll(ATTRIBUTE)].map(([, key, value]) => [key, decode(value)]),
    );
    return {
      name: attributes.name ?? '',
      file: attributes.file ?? '',
      durationMs: Number(attributes.time ?? 0) * 1000,
      outcome: outcomeOf(body),
    };
  });
}

/**
 * @param {string} body
 * @returns {Outcome}
 */
function outcomeOf(body) {
  if (/<(failure|error)\b/.test(body)) return 'failed';
  if (/<skipped\b/.test(body)) return 'skipped';
  return 'passed';
}

/** @param {string} value */
function decode(value) {
  return value.replace(/&(lt|gt|quot|apos|amp);/g, (entity) => ENTITIES[entity]);
}
