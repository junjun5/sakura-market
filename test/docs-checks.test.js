import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { checkSpan, extractCodeSpans, undocumentedScripts } from '../scripts/check-agents-md.js';
import { DOCS_PATH, renderApiDocs, SPEC_PATH } from '../scripts/gen-api-docs.js';

/** @param {Partial<import('../scripts/check-agents-md.js').Repo>} [overrides] */
function fakeRepo(overrides = {}) {
  const files = new Set(['src/app.js', 'scripts/dev.sh', 'scripts/new.sh', 'package.json', 'test']);
  return {
    exists: (/** @type {string} */ path) => files.has(path),
    isExecutable: (/** @type {string} */ path) => path !== 'scripts/new.sh',
    scripts: { test: 'node --test', lint: 'eslint .', dev: 'bash scripts/dev.sh' },
    ...overrides,
  };
}

test('code spans are extracted with line numbers, skipping fenced blocks', () => {
  const markdown = [
    'Run `npm test` and `npm run lint`.',
    '```sh',
    'echo `nope`',
    '```',
    'See `src/app.js`.',
  ].join('\n');
  assert.deepEqual(extractCodeSpans(markdown), [
    { line: 1, span: 'npm test' },
    { line: 1, span: 'npm run lint' },
    { line: 5, span: 'src/app.js' },
  ]);
});

test('npm commands must name a package.json script', () => {
  const repo = fakeRepo();
  assert.deepEqual(checkSpan('npm test', repo), []);
  assert.deepEqual(checkSpan('npm run lint', repo), []);
  assert.deepEqual(checkSpan('npm run gone', repo), ['package.json has no "gone" script']);
  assert.deepEqual(checkSpan('npm start', repo), ['package.json has no "start" script']);
  assert.deepEqual(checkSpan('npm ci', repo), []);
});

test('scripts and paths must exist, and shell scripts must be executable', () => {
  const repo = fakeRepo();
  assert.deepEqual(checkSpan('PORT=4000 scripts/dev.sh start', repo), []);
  assert.deepEqual(checkSpan('scripts/gone.sh start', repo), ['scripts/gone.sh does not exist']);
  assert.deepEqual(checkSpan('scripts/new.sh run', repo), ['scripts/new.sh is not executable']);
  assert.deepEqual(checkSpan('node src/app.js', repo), []);
  assert.deepEqual(checkSpan('node src/gone.js', repo), ['src/gone.js does not exist']);
  assert.deepEqual(checkSpan('src/app.js', repo), []);
  assert.deepEqual(checkSpan('package.json', repo), []);
  assert.deepEqual(checkSpan('tsconfig.json', repo), ['tsconfig.json does not exist']);
  assert.deepEqual(checkSpan('test/*.test.js', repo), []);
  assert.deepEqual(checkSpan('node --test src/gone.js', repo), ['src/gone.js does not exist']);
});

test('spans that are not commands or repository paths are ignored', () => {
  const repo = fakeRepo();
  for (const span of ['X-User-Id', 'ci.yml', '{ error: { code, message } }', 'src/<domain>.js', 'u1']) {
    assert.deepEqual(checkSpan(span, repo), [], span);
  }
  assert.deepEqual(checkSpan('see src/gone.js here', repo), ['src/gone.js does not exist']);
});

test('package.json scripts must be documented by npm command or by the file they run', () => {
  const scripts = fakeRepo().scripts;
  assert.deepEqual(undocumentedScripts('Run `npm test`.', scripts), ['lint', 'dev']);
  assert.deepEqual(
    undocumentedScripts('Run `npm test`, `npm run lint` and `scripts/dev.sh start`.', scripts),
    [],
  );
});

test('generated API docs match openapi.json', () => {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
  assert.equal(readFileSync(DOCS_PATH, 'utf8'), renderApiDocs(spec), 'run npm run docs:api');
});

test('API docs render routes, parameters, bodies, responses and schemas', () => {
  const spec = {
    info: { title: 'Demo API', description: 'A demo.' },
    paths: {
      '/things/{id}': {
        put: {
          operationId: 'putThing',
          summary: 'Replace a thing',
          description: 'Longer words.',
          security: [{ user: [] }],
          parameters: [
            { $ref: '#/components/parameters/ThingId' },
            { name: 'X-User-Id', in: 'header', schema: { type: 'string' } },
          ],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } },
          },
          responses: {
            200: { description: 'Replaced' },
            404: { description: 'Not found', 'x-error-codes': ['thing_not_found'] },
          },
        },
      },
    },
    components: {
      parameters: {
        ThingId: {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Thing ID',
          schema: { type: 'string' },
        },
      },
      schemas: {
        Thing: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', maxLength: 10, description: 'Shown name.' },
            tags: { type: 'array', items: { enum: ['a', 'b'] } },
            kind: { const: 'thing' },
            size: { type: ['integer', 'null'], minimum: 1 },
          },
        },
        Flag: { type: 'boolean' },
      },
    },
  };
  const docs = renderApiDocs(spec);
  assert.match(docs, /^<!-- Generated from openapi\.json/);
  assert.match(docs, /\| PUT \| `\/things\/\{id\}` \| yes \| Replace a thing \|/);
  assert.match(docs, /Longer words\.\n\nAuth: `X-User-Id` required\./);
  assert.match(docs, /\| `id` \| path \| string \| yes \| Thing ID \|/);
  assert.doesNotMatch(docs, /\| `X-User-Id` \| header/);
  assert.match(docs, /\| `name` \| string \| yes \| Shown name\. max length 10 \|/);
  assert.match(docs, /\| `tags` \| "a" \\\| "b"\[\] \| no \|/);
  assert.match(docs, /\| `kind` \| "thing" \| no \|/);
  assert.match(docs, /\| `size` \| integer \\\| null \| no \| min 1 \|/);
  assert.match(docs, /\| 404 \| Not found \| `thing_not_found` \|/);
  assert.match(docs, /### Flag\n\nboolean\n/);
});
