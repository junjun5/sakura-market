import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { createFlags } from './flags.js';
import { createLogger } from './logger.js';

// Local settings from .env (gitignored; template in .env.example). Variables that
// are already set in the environment keep their value.
const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
let envWarning = null;
if (existsSync(ENV_FILE)) {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV_FILE);
  else envWarning = '.env found but ignored: loading it needs Node.js 20.12 or newer.';
}

const logger = createLogger({ level: process.env.LOG_LEVEL ?? 'info' });
if (envWarning) logger.warn(envWarning);
const flags = createFlags(process.env.FEATURE_FLAGS);
const port = Number(process.env.PORT ?? 3000);
const server = createServer(createApp({ logger, flags }));

server.listen(port, () => {
  logger.info('listening', { url: `http://localhost:${port}`, flags: flags.list() });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
