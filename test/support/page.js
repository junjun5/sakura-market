import { createServer } from 'node:http';

import { createApiClient, createController } from '../../public/controller.js';
import { createApp } from '../../src/app.js';

// Wraps the real fetch so a test can hold a request before it is sent, or hold
// its real response before the page sees it. Every request is logged.
export function createNetwork() {
  const log = [];
  const rules = [];

  function hold(method, pathPrefix, { phase = 'deliver' } = {}) {
    let release;
    let fail;
    let markStarted;
    let markAnswered;
    const gate = new Promise((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    const handle = {
      phase,
      gate,
      release: () => release(),
      fail: (err) => fail(err),
      started: new Promise((resolve) => (markStarted = resolve)),
      answered: new Promise((resolve) => (markAnswered = resolve)),
    };
    rules.push({ method, pathPrefix, handle, markStarted, markAnswered });
    return handle;
  }

  async function fetchThrough(url, init) {
    // Not new URL(): it would drop the bare "?" of an unfiltered listings path.
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = init.method ?? 'GET';
    log.push({ method, path, userId: init.headers['x-user-id'], body: init.body });
    const index = rules.findIndex((r) => r.method === method && path.startsWith(r.pathPrefix));
    const rule = index === -1 ? null : rules.splice(index, 1)[0];
    if (!rule) return fetch(url, init);
    rule.markStarted();
    if (rule.handle.phase === 'send') await rule.handle.gate;
    const res = await fetch(url, init);
    rule.markAnswered();
    if (rule.handle.phase === 'deliver') await rule.handle.gate;
    return res;
  }

  return { log, hold, fetch: fetchThrough };
}

// Runs the page's controller against a fresh real server, with recorded
// renders and messages in place of the DOM.
export async function withPage(run, { userId = 'u1', store } = {}) {
  const server = createServer(createApp(store ? { store } : {}));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const net = createNetwork();
  const filters = { q: '', onSale: false };
  const messages = [];
  const controller = createController({
    api: createApiClient(net.fetch, base),
    userId,
    filters: () => ({ ...filters }),
    render: () => {},
    showMessage: (text, kind = 'info') => messages.push({ text, kind }),
  });

  const server$ = async (method, path, user = 'u1') => {
    const res = await fetch(base + path, { method, headers: { 'x-user-id': user } });
    return res.json();
  };
  const serverState = async (id, user = controller.state.userId) => {
    const { listing } = await server$('GET', `/api/listings/${id}`, user);
    return { savedByMe: listing.savedByMe, savedCount: listing.savedCount };
  };
  // What the page currently shows for a card: the in-flight value while pending.
  const shown = (id) => {
    const listing = controller.state.listings?.find((l) => l.id === id);
    if (!listing) return null;
    const { savedByMe, savedCount } = controller.pendingFor(id) ?? listing;
    return { savedByMe, savedCount };
  };
  const mutations = () => net.log.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);
  const lastMessage = () => messages.at(-1) ?? null;

  try {
    await run({ controller, net, filters, messages, lastMessage, server$, serverState, shown, mutations });
  } finally {
    // A failed assertion can leave a held response unread on an open connection.
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
