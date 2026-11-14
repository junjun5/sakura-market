// A small JSON Schema validator for the subset docs/api/openapi.json uses
// ($ref, type, const, enum, required, properties, additionalProperties, items,
// minimum, maximum, minLength, maxLength, pattern). Returns a list of problems;
// an empty list means the value matches.

const TYPE_CHECKS = {
  null: (v) => v === null,
  boolean: (v) => typeof v === 'boolean',
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  array: (v) => Array.isArray(v),
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
};

const RULES = [
  (schema, value, path) => {
    if (schema.type === undefined) return [];
    const types = [schema.type].flat();
    return types.some((t) => TYPE_CHECKS[t](value)) ? [] : [`${path}: expected ${types.join(' or ')}`];
  },
  (schema, value, path) =>
    'const' in schema && value !== schema.const ? [`${path}: expected ${JSON.stringify(schema.const)}`] : [],
  (schema, value, path) =>
    schema.enum && !schema.enum.includes(value) ? [`${path}: expected one of ${schema.enum.join(', ')}`] : [],
  (schema, value, path) =>
    typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum
      ? [`${path}: below ${schema.minimum}`]
      : [],
  (schema, value, path) =>
    typeof value === 'number' && schema.maximum !== undefined && value > schema.maximum
      ? [`${path}: above ${schema.maximum}`]
      : [],
  (schema, value, path) =>
    typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength
      ? [`${path}: shorter than ${schema.minLength}`]
      : [],
  (schema, value, path) =>
    typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength
      ? [`${path}: longer than ${schema.maxLength}`]
      : [],
  (schema, value, path) =>
    typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)
      ? [`${path}: does not match ${schema.pattern}`]
      : [],
];

export function validate(root, schema, value, path = '$') {
  const resolved = resolve(root, schema);
  const problems = RULES.flatMap((rule) => rule(resolved, value, path));
  if (TYPE_CHECKS.object(value)) problems.push(...validateObject(root, resolved, value, path));
  if (Array.isArray(value) && resolved.items) {
    value.forEach((item, i) => problems.push(...validate(root, resolved.items, item, `${path}[${i}]`)));
  }
  return problems;
}

function validateObject(root, schema, value, path) {
  const properties = schema.properties ?? {};
  const missing = (schema.required ?? [])
    .filter((key) => !(key in value))
    .map((key) => `${path}.${key}: missing`);
  const extra =
    schema.additionalProperties === false
      ? Object.keys(value)
          .filter((key) => !(key in properties))
          .map((key) => `${path}.${key}: not in the schema`)
      : [];
  const nested = Object.entries(properties)
    .filter(([key]) => key in value)
    .flatMap(([key, propertySchema]) => validate(root, propertySchema, value[key], `${path}.${key}`));
  return [...missing, ...extra, ...nested];
}

export function resolve(root, schema) {
  if (!schema.$ref) return schema;
  const target = schema.$ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((node, key) => node?.[key], root);
  if (!target) throw new Error(`Unresolvable $ref ${schema.$ref}`);
  return resolve(root, target);
}
