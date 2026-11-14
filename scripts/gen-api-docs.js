#!/usr/bin/env node
// Generates docs/api/README.md from docs/api/openapi.json, so the human-readable
// API reference cannot drift from the schema the contract tests check.
//   node scripts/gen-api-docs.js          rewrite docs/api/README.md
//   node scripts/gen-api-docs.js --check  fail if docs/api/README.md is stale (npm run check)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SPEC_PATH = 'docs/api/openapi.json';
export const DOCS_PATH = 'docs/api/README.md';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * @typedef {{ $ref?: string, type?: string | string[], enum?: unknown[], const?: unknown, items?: Schema,
 *   properties?: Record<string, Schema>, required?: string[], description?: string, minimum?: number,
 *   maximum?: number, minLength?: number, maxLength?: number, format?: string }} Schema
 * @typedef {{ name: string, in: string, required?: boolean, description?: string, schema: Schema }} Parameter
 * @typedef {{ description: string, 'x-error-codes'?: string[], content?: Record<string, { schema: Schema }> }} ApiResponse
 * @typedef {{ operationId: string, summary: string, description?: string, security?: object[],
 *   parameters?: (Parameter | { $ref: string })[], requestBody?: { content: Record<string, { schema: Schema }> },
 *   responses: Record<string, ApiResponse> }} Operation
 * @typedef {{ info: { title: string, description: string }, paths: Record<string, Record<string, Operation>>,
 *   components: Record<string, Record<string, any>> }} Spec
 */

/**
 * @param {Spec} spec
 * @param {object} node
 * @returns {any}
 */
function deref(spec, node) {
  if (!('$ref' in node) || typeof node.$ref !== 'string') return node;
  const [, , section, name] = node.$ref.split('/');
  return deref(spec, spec.components[section][name]);
}

/**
 * @param {Spec} spec
 * @param {Schema} schema
 * @returns {string}
 */
function typeName(spec, schema) {
  if (schema.$ref) return schema.$ref.split('/').pop() ?? '';
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' \\| ');
  if (schema.type === 'array' && schema.items) return `${typeName(spec, schema.items)}[]`;
  return [schema.type ?? 'any'].flat().join(' \\| ');
}

/** @param {Schema} schema */
function limits(schema) {
  const parts = [];
  if (schema.minimum !== undefined) parts.push(`min ${schema.minimum}`);
  if (schema.maximum !== undefined) parts.push(`max ${schema.maximum}`);
  if (schema.minLength !== undefined) parts.push(`min length ${schema.minLength}`);
  if (schema.maxLength !== undefined) parts.push(`max length ${schema.maxLength}`);
  if (schema.format) parts.push(schema.format);
  return parts.join(', ');
}

/**
 * @param {Spec} spec
 * @param {Schema} schema
 */
function fieldRows(spec, schema) {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, field]) => {
    const notes = [field.description, limits(field)].filter(Boolean).join(' ');
    return `| \`${name}\` | ${typeName(spec, field)} | ${required.has(name) ? 'yes' : 'no'} | ${notes} |`;
  });
}

/**
 * @param {Spec} spec
 * @param {string} method
 * @param {string} path
 * @param {Operation} operation
 */
function operationSection(spec, method, path, operation) {
  const lines = [`### ${method.toUpperCase()} \`${path}\``, '', operation.summary + '.', ''];
  if (operation.description) lines.push(operation.description, '');
  lines.push(`Auth: ${operation.security ? '`X-User-Id` required' : 'none'}.`, '');

  lines.push(
    ...parameterTable(spec, operation),
    ...requestBodyTable(spec, operation),
    ...responseTable(operation),
  );
  return lines;
}

/**
 * @param {Spec} spec
 * @param {Operation} operation
 */
function parameterTable(spec, operation) {
  /** @type {Parameter[]} */
  const parameters = (operation.parameters ?? []).map((p) => deref(spec, p)).filter((p) => p.in !== 'header');
  if (parameters.length === 0) return [];
  return [
    '| Parameter | In | Type | Required | Description |',
    '| --- | --- | --- | --- | --- |',
    ...parameters.map(
      (p) =>
        `| \`${p.name}\` | ${p.in} | ${typeName(spec, p.schema)} | ${p.required ? 'yes' : 'no'} | ${p.description ?? ''} |`,
    ),
    '',
  ];
}

/**
 * @param {Spec} spec
 * @param {Operation} operation
 */
function requestBodyTable(spec, operation) {
  const body = operation.requestBody?.content['application/json']?.schema;
  if (!body) return [];
  return [
    'Request body (JSON):',
    '',
    '| Field | Type | Required | Notes |',
    '| --- | --- | --- | --- |',
    ...fieldRows(spec, body),
    '',
  ];
}

/** @param {Operation} operation */
function responseTable(operation) {
  const rows = Object.entries(operation.responses).map(([status, response]) => {
    const codes = (response['x-error-codes'] ?? []).map((c) => `\`${c}\``).join(', ');
    return `| ${status} | ${response.description} | ${codes} |`;
  });
  return ['| Status | Meaning | Error codes |', '| --- | --- | --- |', ...rows, ''];
}

/**
 * @param {Spec} spec
 * @param {string} name
 */
function schemaSection(spec, name) {
  const schema = spec.components.schemas[name];
  if (!schema.properties) return [`### ${name}`, '', `${typeName(spec, schema)}`, ''];
  return [
    `### ${name}`,
    '',
    '| Field | Type | Required | Notes |',
    '| --- | --- | --- | --- |',
    ...fieldRows(spec, schema),
    '',
  ];
}

/** @param {Spec} spec */
export function renderApiDocs(spec) {
  const entries = Object.entries(spec.paths).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => ({ method: m, path, operation: item[m] })),
  );
  return [
    '<!-- Generated from openapi.json by scripts/gen-api-docs.js. Do not edit; run npm run docs:api. -->',
    '',
    `# ${spec.info.title}`,
    '',
    spec.info.description,
    '',
    'The machine-readable schema is [openapi.json](openapi.json); test/openapi.test.js checks the running app against it.',
    '',
    '## Routes',
    '',
    '| Method | Path | Auth | Summary |',
    '| --- | --- | --- | --- |',
    ...entries.map(
      (e) =>
        `| ${e.method.toUpperCase()} | \`${e.path}\` | ${e.operation.security ? 'yes' : 'no'} | ${e.operation.summary} |`,
    ),
    '',
    '## Operations',
    '',
    ...entries.flatMap((e) => operationSection(spec, e.method, e.path, e.operation)),
    '## Schemas',
    '',
    ...Object.keys(spec.components.schemas).flatMap((name) => schemaSection(spec, name)),
  ].join('\n');
}

function main() {
  const expected = renderApiDocs(JSON.parse(readFileSync(SPEC_PATH, 'utf8')));
  if (!process.argv.includes('--check')) {
    writeFileSync(DOCS_PATH, expected);
    console.log(`Wrote ${DOCS_PATH}.`);
    return;
  }
  let current = '';
  try {
    current = readFileSync(DOCS_PATH, 'utf8');
  } catch {
    // missing counts as stale
  }
  if (current !== expected) {
    console.error(
      `${DOCS_PATH} is out of date with ${SPEC_PATH}. Run npm run docs:api and commit the result.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`${DOCS_PATH} matches ${SPEC_PATH}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
