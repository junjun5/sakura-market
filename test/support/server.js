import { createServer } from 'node:http';

import { createApp } from '../../src/app.js';

// Starts a fresh server on a random port for one test. `appOptions` (store, now,
// logger, metrics, flags) go to createApp, so a test can bring its own fixtures.
// `call` resolves with the status, the parsed JSON body (or text) and headers.
export async function withServer(run, appOptions = {}) {
  const server = createServer(createApp(appOptions));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, { userId, body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(userId ? { 'x-user-id': userId } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    const isJson = res.headers.get('content-type')?.includes('application/json');
    return { status: res.status, body: isJson ? JSON.parse(text) : text, headers: res.headers };
  };

  try {
    await run(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
