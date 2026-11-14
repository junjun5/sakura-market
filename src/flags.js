// Feature flags. Ship a risky change behind a flag that is off by default, then
// switch it per environment with FEATURE_FLAGS="name=on,other=off" (see
// .env.example). Every flag is declared here with its default, so a typo in
// FEATURE_FLAGS or in code fails loudly instead of silently doing nothing.

/** @typedef {{ defaultEnabled: boolean, description: string }} FlagDefinition */
/** @typedef {{ isEnabled: (name: string) => boolean, list: () => { name: string, enabled: boolean }[] }} Flags */

/** @type {Record<string, FlagDefinition>} */
export const FLAGS = {
  metrics_endpoint: {
    defaultEnabled: true,
    description: 'Serve request and process metrics in the Prometheus format at GET /api/metrics.',
  },
};

const ON_VALUES = ['on', 'true', '1'];
const OFF_VALUES = ['off', 'false', '0'];

/**
 * @param {string} [spec] comma-separated `name=on|off` pairs; a bare `name` means on
 * @param {Record<string, FlagDefinition>} [definitions]
 * @returns {Flags}
 */
export function createFlags(spec = '', definitions = FLAGS) {
  const values = new Map(Object.entries(definitions).map(([name, flag]) => [name, flag.defaultEnabled]));
  const known = () => [...values.keys()].join(', ');

  for (const entry of spec.split(',').map((part) => part.trim())) {
    if (!entry) continue;
    const [name, rawValue = 'on', ...extra] = entry.split('=').map((part) => part.trim());
    if (!values.has(name)) {
      throw new Error(`Unknown feature flag "${name}" in FEATURE_FLAGS. Known flags: ${known()}.`);
    }
    const value = rawValue.toLowerCase();
    if (extra.length > 0 || ![...ON_VALUES, ...OFF_VALUES].includes(value)) {
      throw new Error(`Feature flag "${name}" must be on or off; got "${entry}".`);
    }
    values.set(name, ON_VALUES.includes(value));
  }

  return {
    isEnabled(name) {
      const enabled = values.get(name);
      if (enabled === undefined) throw new Error(`Unknown feature flag "${name}". Known flags: ${known()}.`);
      return enabled;
    },
    list: () => [...values].map(([name, enabled]) => ({ name, enabled })),
  };
}
