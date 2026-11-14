// Redaction for anything written to the server log. Logs get copied into issues,
// CI output and chat, so credentials and personal data are masked first.

export const REDACTED = '[redacted]';

// Object keys whose values are credentials. X-User-Id is this service's (mock)
// auth credential, so it is masked like a token.
export const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|token|secret|passw(?:or)?d|api[-_]?key|session|x-user-id/i;

// Values that are sensitive wherever they appear inside free text such as error
// messages and stack traces.
const SENSITIVE_TEXT_RULES = [
  [/\b(Bearer|Basic)\s+[^\s"',;]+/gi, `$1 ${REDACTED}`],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED],
];

// Deeper structures are cut off so a huge or self-referencing object cannot
// flood the log.
export const MAX_REDACT_DEPTH = 6;

// Returns a redacted copy of `value`; the input is never modified. Errors become
// plain objects (name, message, stack, own fields, cause) so they survive logging.
export function redact(value) {
  return redactValue(value, 0, new Set());
}

export function redactText(text) {
  return SENSITIVE_TEXT_RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

function redactValue(value, depth, ancestors) {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return '[circular]';
  if (depth >= MAX_REDACT_DEPTH) return '[truncated]';

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1, ancestors));
    const out = {};
    if (value instanceof Error) {
      out.name = value.name;
      out.message = redactText(value.message);
      if (value.stack) out.stack = redactText(value.stack);
    }
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(item, depth + 1, ancestors);
    }
    if (value instanceof Error && value.cause !== undefined) {
      out.cause = redactValue(value.cause, depth + 1, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}
