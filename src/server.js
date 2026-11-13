import { createServer } from 'node:http';

import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const server = createServer(createApp());

server.listen(port, () => {
  console.log(`sakura-market-mini listening on http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
