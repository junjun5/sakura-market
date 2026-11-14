// Structured logger: one JSON object per line, so logs can be searched and
// filtered by field (for example every line with one requestId). Every field
// goes through redact() first, so callers can pass request data as it is.
import { redact } from './redact.js';

export const LOG_LEVELS = /** @type {const} */ (['debug', 'info', 'warn', 'error', 'silent']);

/**
 * @typedef {typeof LOG_LEVELS[number]} LogLevel
 * @typedef {Exclude<LogLevel, 'silent'>} Severity
 * @typedef {(line: string, severity: Severity) => void} LogWriter
 * @typedef {{
 *   debug: (msg: string, fields?: Record<string, unknown>) => void,
 *   info: (msg: string, fields?: Record<string, unknown>) => void,
 *   warn: (msg: string, fields?: Record<string, unknown>) => void,
 *   error: (msg: string, fields?: Record<string, unknown>) => void,
 *   child: (fields: Record<string, unknown>) => Logger,
 * }} Logger
 */

/** @type {LogWriter} */
const writeToProcess = (line, severity) => {
  const stream = severity === 'warn' || severity === 'error' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
};

/**
 * @param {{ level?: string, write?: LogWriter, now?: () => Date, base?: Record<string, unknown> }} [options]
 * @returns {Logger}
 */
export function createLogger({
  level = 'info',
  write = writeToProcess,
  now = () => new Date(),
  base = {},
} = {}) {
  const threshold = LOG_LEVELS.indexOf(/** @type {LogLevel} */ (level));
  if (threshold === -1) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}; got "${level}".`);
  }

  /**
   * @param {Severity} severity
   * @param {string} msg
   * @param {Record<string, unknown>} fields
   */
  function log(severity, msg, fields) {
    if (LOG_LEVELS.indexOf(severity) < threshold) return;
    const entry = {
      time: now().toISOString(),
      level: severity,
      msg,
      ...toRecord(redact({ ...base, ...fields })),
    };
    write(
      JSON.stringify(entry, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
      severity,
    );
  }

  return {
    debug: (msg, fields = {}) => log('debug', msg, fields),
    info: (msg, fields = {}) => log('info', msg, fields),
    warn: (msg, fields = {}) => log('warn', msg, fields),
    error: (msg, fields = {}) => log('error', msg, fields),
    child: (fields) => createLogger({ level, write, now, base: { ...base, ...fields } }),
  };
}

/** @param {unknown} value */
const toRecord = (value) => /** @type {Record<string, unknown>} */ (value);
