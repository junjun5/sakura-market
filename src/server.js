import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';

// Local settings from .env (gitignored; template in .env.example). Variables that
// are already set in the environment keep their value.
const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(ENV_FILE)) {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV_FILE);
  else console.warn('.env found but ignored: loading it needs Node.js 20.12 or newer.');
}

const port = Number(process.env.PORT ?? 3000);
const server = createServer(createApp());

server.listen(port, () => {
  console.log(`sakura-market-mini listening on http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
