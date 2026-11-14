import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createStore } from '../src/store.js';
import { withPage } from './support/page.js';

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
    assert.deepEqual(
      controller.state.listings.map((l) => l.id),
      ['l2'],
    );
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
    assert.deepEqual(
      controller.state.listings.map((l) => l.id),
      ['l2'],
    );

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
    assert.equal(
      messages.some((m) => m.kind === 'error'),
      false,
    );
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
    updatedAt: null,
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

test("page: a save that settles after a user switch leaves the new user's page alone", () =>
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
    assert.deepEqual(
      controller.state.listings.map((l) => [l.id, l.savedByMe]),
      [['l2', true]],
    );
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
