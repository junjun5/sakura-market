import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { createApiClient, createController } from '../public/controller.js';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';

// Wraps the real fetch so a test can hold a request before it is sent, or hold
// its real response before the page sees it. Every request is logged.
function createNetwork() {
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
    log.push({ method, path, userId: init.headers['x-user-id'] });
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
async function withPage(run, { userId = 'u1', store } = {}) {
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

test('page: a refresh begun before a save cannot revert the settled save', () =>
  withPage(async ({ controller, net, filters, lastMessage, serverState, shown, mutations }) => {
    await controller.reloadFresh();
    assert.deepEqual(shown('l2'), { savedByMe: false, savedCount: 0 });

    const staleGet = net.hold('GET', '/api/listings?');
    filters.q = 'helmet';
    const staleLoad = controller.loadView();
    await staleGet.answered;

    await controller.toggleFavorite('l2');
    assert.deepEqual(shown('l2'), { savedByMe: true, savedCount: 1 });
    assert.deepEqual(await serverState('l2'), { savedByMe: true, savedCount: 1 });
    // The reconciling load keeps the active search.
    assert.equal(net.log.at(-1).path, '/api/listings?q=helmet');

    staleGet.release();
    await staleLoad;
    assert.deepEqual(shown('l2'), { savedByMe: true, savedCount: 1 });
    assert.deepEqual(controller.state.listings.map((l) => l.id), ['l2']);
    assert.equal(lastMessage()?.kind ?? 'info', 'info');

    await controller.toggleFavorite('l2');
    assert.deepEqual(mutations(), ['PUT /api/listings/l2/favorite', 'DELETE /api/listings/l2/favorite']);
    assert.deepEqual(shown('l2'), { savedByMe: false, savedCount: 0 });
    assert.deepEqual(await serverState('l2'), { savedByMe: false, savedCount: 0 });
  }));

test('page: a refresh begun before a removal cannot restore the heart in All', () =>
  withPage(async ({ controller, net, filters, server$, serverState, shown, mutations }) => {
    await server$('PUT', '/api/listings/l2/favorite');
    await controller.reloadFresh();
    assert.deepEqual(shown('l2'), { savedByMe: true, savedCount: 1 });

    const staleGet = net.hold('GET', '/api/listings?');
    filters.q = 'helmet';
    const staleLoad = controller.loadView();
    await staleGet.answered;

    await controller.toggleFavorite('l2');
    assert.deepEqual(shown('l2'), { savedByMe: false, savedCount: 0 });

    staleGet.release();
    await staleLoad;
    assert.deepEqual(shown('l2'), { savedByMe: false, savedCount: 0 });
    assert.deepEqual(await serverState('l2'), { savedByMe: false, savedCount: 0 });

    await controller.toggleFavorite('l2');
    assert.deepEqual(mutations(), ['DELETE /api/listings/l2/favorite', 'PUT /api/listings/l2/favorite']);
    assert.deepEqual(shown('l2'), { savedByMe: true, savedCount: 1 });
  }));

test('page: a Saved refresh begun before a removal cannot bring the card back', () =>
  withPage(async ({ controller, net, server$, serverState, shown }) => {
    await server$('PUT', '/api/listings/l2/favorite');
    await controller.setView('saved');
    assert.deepEqual(controller.state.listings.map((l) => l.id), ['l2']);

    const staleGet = net.hold('GET', '/api/me/favorites');
    const staleLoad = controller.loadView();
    await staleGet.answered;

    await controller.toggleFavorite('l2');
    assert.deepEqual(controller.state.listings, []);

    staleGet.release();
    await staleLoad;
    assert.deepEqual(controller.state.listings, []);
    assert.equal(shown('l2'), null);
    assert.deepEqual(await serverState('l2'), { savedByMe: false, savedCount: 0 });
  }));

test('page: a refresh answered during a save and delivered after it cannot overwrite it', () =>
  withPage(async ({ controller, net, filters, serverState, shown }) => {
    await controller.reloadFresh();

    const put = net.hold('PUT', '/api/listings/l2/favorite', { phase: 'send' });
    const toggle = controller.toggleFavorite('l2');
    await put.started;
    assert.deepEqual(shown('l2'), { savedByMe: true, savedCount: 1 });

    const staleGet = net.hold('GET', '/api/listings?');
    filters.q = 'helmet';
    const staleLoad = controller.loadView();
    await staleGet.answered;

    put.release();
    await toggle;
    assert.deepEqual(shown('l2'), { savedByMe: true, savedCount: 1 });

    staleGet.release();
    await staleLoad;
    assert.deepEqual(shown('l2'), { savedByMe: true, savedCount: 1 });
    assert.deepEqual(await serverState('l2'), { savedByMe: true, savedCount: 1 });
  }));

test('page: a late error from a refresh begun before a save is ignored', () =>
  withPage(async ({ controller, net, filters, messages, shown }) => {
    await controller.reloadFresh();

    const staleGet = net.hold('GET', '/api/listings?');
    filters.q = 'helmet';
    const staleLoad = controller.loadView();
    await staleGet.answered;

    await controller.toggleFavorite('l2');
    staleGet.fail(new Error('Held refresh failed.'));
    await staleLoad;

    assert.deepEqual(shown('l2'), { savedByMe: true, savedCount: 1 });
    assert.equal(controller.state.loadFailed, false);
    assert.equal(messages.some((m) => m.kind === 'error'), false);
  }));

test('page: a failed save rolls back with the server message, and an older refresh stays harmless', async () => {
  const listings = Array.from({ length: 101 }, (_, i) => ({
    id: `l${i + 1}`,
    title: `Item ${i + 1}`,
    description: '',
    priceYen: 1000,
    sellerId: 'u2',
    status: 'on_sale',
    buyerId: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  }));
  await withPage(
    async ({ controller, net, lastMessage, server$, serverState, shown }) => {
      for (let i = 2; i <= 101; i += 1) await server$('PUT', `/api/listings/l${i}/favorite`);
      await controller.reloadFresh();
      assert.deepEqual(shown('l1'), { savedByMe: false, savedCount: 0 });

      const staleGet = net.hold('GET', '/api/listings?');
      const staleLoad = controller.loadView();
      await staleGet.answered;

      await controller.toggleFavorite('l1');
      assert.deepEqual(shown('l1'), { savedByMe: false, savedCount: 0 });
      assert.equal(lastMessage().kind, 'error');
      assert.match(lastMessage().text, /100/);
      // After a failure the server is unchanged, so no further load is needed.
      assert.equal(net.log.filter((r) => r.method === 'GET').length, 2);

      staleGet.release();
      await staleLoad;
      assert.deepEqual(shown('l1'), { savedByMe: false, savedCount: 0 });
      assert.deepEqual(await serverState('l1'), { savedByMe: false, savedCount: 0 });
    },
    { store: createStore({ listings }) },
  );
});

test('page: a save that settles after a user switch leaves the new user\'s page alone', () =>
  withPage(async ({ controller, net, serverState, shown }) => {
    await controller.reloadFresh();

    const put = net.hold('PUT', '/api/listings/l2/favorite');
    const toggle = controller.toggleFavorite('l2');
    await put.answered;

    await controller.setUser('u3');
    assert.deepEqual(shown('l2'), { savedByMe: false, savedCount: 1 });
    const requestsAfterSwitch = net.log.length;

    put.release();
    await toggle;
    assert.deepEqual(shown('l2'), { savedByMe: false, savedCount: 1 });
    assert.equal(net.log.length, requestsAfterSwitch);
    assert.deepEqual(await serverState('l2', 'u1'), { savedByMe: true, savedCount: 1 });
  }));

test('page: a save that settles after switching to Saved shows the Saved list', () =>
  withPage(async ({ controller, net }) => {
    await controller.reloadFresh();

    const put = net.hold('PUT', '/api/listings/l2/favorite', { phase: 'send' });
    const toggle = controller.toggleFavorite('l2');
    await put.started;
    const savedView = controller.setView('saved');
    await savedView;
    assert.deepEqual(controller.state.listings, []);

    put.release();
    await toggle;
    assert.equal(controller.state.view, 'saved');
    assert.deepEqual(controller.state.listings.map((l) => [l.id, l.savedByMe]), [['l2', true]]);
  }));

test('page: toggles on different cards stay independent', () =>
  withPage(async ({ controller, net, serverState, shown }) => {
    await controller.reloadFresh();

    const helmetPut = net.hold('PUT', '/api/listings/l2/favorite');
    const helmet = controller.toggleFavorite('l2');
    await helmetPut.answered;
    // A second press of the same in-flight heart does nothing.
    await controller.toggleFavorite('l2');

    await controller.toggleFavorite('l3');
    assert.deepEqual(shown('l3'), { savedByMe: true, savedCount: 1 });
    // The reload after the keyboard save must not settle the helmet early.
    assert.deepEqual(controller.pendingFor('l2'), { savedByMe: true, savedCount: 1 });

    helmetPut.release();
    await helmet;
    assert.equal(controller.pendingFor('l2'), undefined);
    assert.deepEqual(shown('l2'), { savedByMe: true, savedCount: 1 });
    assert.deepEqual(shown('l3'), { savedByMe: true, savedCount: 1 });
    assert.deepEqual(await serverState('l2'), { savedByMe: true, savedCount: 1 });
    assert.deepEqual(await serverState('l3'), { savedByMe: true, savedCount: 1 });
    assert.equal(net.log.filter((r) => r.method === 'PUT').length, 2);
  }));
