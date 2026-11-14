import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withPage } from './support/page.js';

const KEN = { userId: 'u2' };
const ids = (controller) => controller.state.listings.map((l) => l.id);
const statusOf = async (server$, id) => (await server$('GET', `/api/listings/${id}`, 'u2')).listing.status;

test('page withdrawals: Withdraw removes the card in place and a stale load cannot bring it back', () =>
  withPage(async ({ controller, net, lastMessage, mutations, server$ }) => {
    await controller.reloadFresh();
    assert.deepEqual(ids(controller), ['l5', 'l4', 'l3', 'l2', 'l1']);

    const staleGet = net.hold('GET', '/api/listings?');
    const staleLoad = controller.loadView();
    await staleGet.answered;

    await controller.withdraw('l3');
    assert.deepEqual(ids(controller), ['l5', 'l4', 'l2', 'l1']);
    assert.deepEqual(lastMessage(), { text: 'Withdrew "Mechanical keyboard".', kind: 'info' });
    assert.deepEqual(mutations(), ['POST /api/listings/l3/withdraw']);
    assert.equal(net.log.find((r) => r.method === 'POST').userId, 'u2');
    assert.equal(controller.withdrawingFor('l3'), false);
    // The reconciling load runs after the withdraw.
    assert.equal(net.log.at(-1).method, 'GET');

    staleGet.release();
    await staleLoad;
    assert.deepEqual(ids(controller), ['l5', 'l4', 'l2', 'l1']);
    assert.equal(await statusOf(server$, 'l3'), 'withdrawn');
  }, KEN));

test('page withdrawals: withdrawing the only search result leaves the search empty', () =>
  withPage(async ({ controller, filters }) => {
    filters.q = 'keyboard';
    await controller.reloadFresh();
    assert.deepEqual(ids(controller), ['l3']);

    await controller.withdraw('l3');
    assert.deepEqual(ids(controller), []);

    filters.q = '';
    await controller.loadView();
    assert.deepEqual(ids(controller), ['l5', 'l4', 'l2', 'l1']);
    filters.onSale = true;
    await controller.loadView();
    assert.deepEqual(ids(controller), ['l5', 'l2', 'l1']);
  }, KEN));

test('page withdrawals: a rejected withdraw shows the server message and keeps the card', () =>
  withPage(async ({ controller, lastMessage, server$ }) => {
    await controller.reloadFresh();
    await server$('POST', '/api/listings/l2/purchase', 'u1');

    await controller.withdraw('l2');
    assert.deepEqual(lastMessage(), { text: 'This listing has already been sold.', kind: 'error' });
    assert.deepEqual(ids(controller), ['l5', 'l4', 'l3', 'l2', 'l1']);
    // The refreshed card shows the sale, so it no longer offers Withdraw.
    assert.equal(controller.state.listings.find((l) => l.id === 'l2').status, 'sold');
    assert.equal(await statusOf(server$, 'l2'), 'sold');
  }, KEN));

test('page withdrawals: a second Withdraw while one is in flight is ignored', () =>
  withPage(async ({ controller, net, mutations }) => {
    await controller.reloadFresh();
    const post = net.hold('POST', '/api/listings/l3/withdraw');
    const first = controller.withdraw('l3');
    await post.answered;
    assert.equal(controller.withdrawingFor('l3'), true);
    assert.equal(controller.withdrawingFor('l2'), false);
    await controller.withdraw('l3');

    post.release();
    await first;
    assert.deepEqual(mutations(), ['POST /api/listings/l3/withdraw']);
    assert.equal(controller.withdrawingFor('l3'), false);
    assert.equal(ids(controller).includes('l3'), false);
  }, KEN));

test("page withdrawals: Withdraw does nothing on other users', sold or unloaded listings", () =>
  withPage(async ({ controller, mutations, server$ }) => {
    await controller.withdraw('l3');
    await server$('POST', '/api/listings/l2/purchase', 'u1');
    await controller.reloadFresh();
    await controller.withdraw('l1');
    await controller.withdraw('l2');
    await controller.withdraw('l4');
    await controller.withdraw('missing');
    assert.deepEqual(mutations(), []);
  }, KEN));

test("page withdrawals: a withdraw that settles after a user switch leaves the new user's page alone", () =>
  withPage(async ({ controller, net, messages, server$ }) => {
    await controller.reloadFresh();
    controller.startEdit('l3');
    const post = net.hold('POST', '/api/listings/l3/withdraw');
    controller.cancelEdit('l3');
    const withdrawing = controller.withdraw('l3');
    await post.answered;
    await controller.setUser('u1');
    const shownToHana = controller.state.listings;
    const requestsAfterSwitch = net.log.length;
    const messagesAfterSwitch = messages.length;

    post.release();
    await withdrawing;
    assert.equal(controller.state.listings, shownToHana);
    assert.equal(net.log.length, requestsAfterSwitch);
    assert.equal(messages.length, messagesAfterSwitch);
    assert.equal(await statusOf(server$, 'l3'), 'withdrawn');

    await controller.setUser('u2');
    assert.equal(ids(controller).includes('l3'), false);
  }, KEN));

test('page withdrawals: a rejection that settles after a user switch shows nothing to the new user', () =>
  withPage(async ({ controller, net, messages, server$ }) => {
    await controller.reloadFresh();
    await server$('POST', '/api/listings/l3/purchase', 'u1');
    const post = net.hold('POST', '/api/listings/l3/withdraw');
    const withdrawing = controller.withdraw('l3');
    await post.answered;
    await controller.setUser('u3');
    const messagesAfterSwitch = messages.length;

    post.release();
    await withdrawing;
    assert.equal(messages.length, messagesAfterSwitch);
    assert.equal(controller.withdrawingFor('l3'), false);
  }, KEN));

test('page withdrawals: withdrawing closes an open edit form for that listing', () =>
  withPage(async ({ controller }) => {
    await controller.reloadFresh();
    controller.startEdit('l3');
    controller.updateDraft('l3', 'title', 'Never saved');
    await controller.withdraw('l3');
    assert.equal(controller.draftFor('l3'), undefined);
    assert.equal(controller.state.editing.size, 0);
  }, KEN));

test('page withdrawals: Saved keeps a withdrawn listing with its count, and the heart removes it', () =>
  withPage(async ({ controller, server$, lastMessage }) => {
    await server$('PUT', '/api/listings/l3/favorite', 'u1');
    await server$('PUT', '/api/listings/l3/favorite', 'u3');
    await controller.reloadFresh();
    await controller.withdraw('l3');

    await controller.setUser('u1');
    assert.equal(ids(controller).includes('l3'), false);
    await controller.setView('saved');
    const saved = controller.state.listings.find((l) => l.id === 'l3');
    assert.deepEqual(
      { status: saved.status, savedCount: saved.savedCount, savedByMe: saved.savedByMe },
      { status: 'withdrawn', savedCount: 2, savedByMe: true },
    );

    await controller.toggleFavorite('l3');
    assert.equal(lastMessage().kind, 'info');
    assert.deepEqual(ids(controller), []);
    await controller.reloadFresh();
    assert.deepEqual(ids(controller), []);

    await controller.setUser('u3');
    assert.equal(controller.state.listings.find((l) => l.id === 'l3').savedCount, 1);
  }, KEN));

test('page withdrawals: an open page cannot newly save a listing withdrawn meanwhile', () =>
  withPage(
    async ({ controller, server$, lastMessage, shown }) => {
      await controller.reloadFresh();
      await server$('POST', '/api/listings/l3/withdraw', 'u2');

      await controller.toggleFavorite('l3');
      assert.deepEqual(lastMessage(), { text: 'This listing has been withdrawn.', kind: 'error' });
      assert.deepEqual(shown('l3'), { savedByMe: false, savedCount: 0 });
      await controller.setView('saved');
      assert.deepEqual(ids(controller), []);
    },
    { userId: 'u3' },
  ));
