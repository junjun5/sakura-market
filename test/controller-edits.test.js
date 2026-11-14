import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withPage } from './support/page.js';

const KEN = { userId: 'u2' };
const HELMET = { title: 'Road bike helmet (M)', priceYen: 4500 };

// What the card shows for a listing, without the draft.
const card = (controller, id) => {
  const listing = controller.state.listings?.find((l) => l.id === id);
  return listing
    ? { title: listing.title, description: listing.description, priceYen: listing.priceYen }
    : null;
};
const ids = (controller) => controller.state.listings.map((l) => l.id);

async function getListing(server$, id) {
  const { listing } = await server$('GET', `/api/listings/${id}`, 'u2');
  return listing;
}

test('page edits: Edit opens a draft with the current values on that card only', () =>
  withPage(async ({ controller, server$ }) => {
    await controller.reloadFresh();
    const helmet = await getListing(server$, 'l2');

    controller.startEdit('l2');
    assert.deepEqual(controller.draftFor('l2'), {
      title: HELMET.title,
      description: helmet.description,
      priceYen: '4500',
      saving: false,
    });
    assert.equal(controller.draftFor('l3'), undefined);
    assert.equal(controller.state.editing.size, 1);

    // Opening it again keeps what was typed.
    controller.updateDraft('l2', 'title', 'Typed');
    controller.startEdit('l2');
    assert.equal(controller.draftFor('l2').title, 'Typed');
  }, KEN));

test("page edits: Edit does nothing on other users', sold or missing listings", () =>
  withPage(async ({ controller, server$ }) => {
    await server$('POST', '/api/listings/l3/purchase', 'u1');
    await controller.reloadFresh();
    controller.startEdit('l1');
    controller.startEdit('l3');
    controller.startEdit('l4');
    controller.startEdit('missing');
    assert.equal(controller.state.editing.size, 0);
  }, KEN));

test('page edits: Edit does nothing before the listings have loaded', () =>
  withPage(async ({ controller }) => {
    controller.startEdit('l2');
    assert.equal(controller.state.editing.size, 0);
  }, KEN));

test('page edits: only draft fields of an open draft can be typed into', () =>
  withPage(async ({ controller }) => {
    await controller.reloadFresh();
    controller.updateDraft('l2', 'title', 'No form open');
    assert.equal(controller.draftFor('l2'), undefined);

    controller.startEdit('l2');
    controller.updateDraft('l2', 'saving', 'true');
    controller.updateDraft('l2', 'status', 'sold');
    controller.updateDraft('l2', 'priceYen', '3900');
    assert.deepEqual(Object.keys(controller.draftFor('l2')).sort(), [
      'description',
      'priceYen',
      'saving',
      'title',
    ]);
    assert.equal(controller.draftFor('l2').saving, false);
    assert.equal(controller.draftFor('l2').priceYen, '3900');
  }, KEN));

test('page edits: Cancel closes the form and changes nothing', () =>
  withPage(async ({ controller, server$, mutations }) => {
    await controller.reloadFresh();
    controller.startEdit('l3');
    controller.updateDraft('l3', 'title', 'Should not stick');
    controller.updateDraft('l3', 'priceYen', '999');
    controller.cancelEdit('l3');
    assert.equal(controller.draftFor('l3'), undefined);
    assert.deepEqual(mutations(), []);
    assert.equal((await getListing(server$, 'l3')).title, 'Mechanical keyboard');

    controller.cancelEdit('l3');
    controller.startEdit('l3');
    assert.equal(controller.draftFor('l3').title, 'Mechanical keyboard');
    assert.equal(controller.draftFor('l3').priceYen, '7800');
  }, KEN));

test('page edits: Save updates the card in place and a stale load cannot revert it', () =>
  withPage(async ({ controller, net, filters, lastMessage, server$ }) => {
    await controller.reloadFresh();
    const order = ids(controller);
    controller.startEdit('l2');
    controller.updateDraft('l2', 'title', 'Road bike helmet (M), barely used');
    controller.updateDraft('l2', 'description', 'Worn twice.');
    controller.updateDraft('l2', 'priceYen', '3900');

    const staleGet = net.hold('GET', '/api/listings?');
    filters.q = '';
    const staleLoad = controller.loadView();
    await staleGet.answered;

    await controller.saveEdit('l2');
    const edited = { title: 'Road bike helmet (M), barely used', description: 'Worn twice.', priceYen: 3900 };
    assert.deepEqual(card(controller, 'l2'), edited);
    assert.deepEqual(ids(controller), order);
    assert.equal(controller.draftFor('l2'), undefined);
    assert.equal(lastMessage().kind, 'info');
    const patch = net.log.find((r) => r.method === 'PATCH');
    assert.deepEqual(
      { path: patch.path, userId: patch.userId, body: JSON.parse(patch.body) },
      { path: '/api/listings/l2', userId: 'u2', body: edited },
    );
    // The reconciling load runs after the save.
    assert.equal(net.log.at(-1).method, 'GET');

    staleGet.release();
    await staleLoad;
    assert.deepEqual(card(controller, 'l2'), edited);
    const stored = await getListing(server$, 'l2');
    assert.deepEqual(
      { title: stored.title, description: stored.description, priceYen: stored.priceYen },
      edited,
    );
    assert.notEqual(stored.updatedAt, null);
  }, KEN));

test('page edits: changing only the description keeps the title and price', () =>
  withPage(async ({ controller, server$ }) => {
    await controller.reloadFresh();
    controller.startEdit('l2');
    controller.updateDraft('l2', 'description', 'Description-only change.');
    await controller.saveEdit('l2');
    const stored = await getListing(server$, 'l2');
    assert.deepEqual(
      [stored.title, stored.description, stored.priceYen],
      [HELMET.title, 'Description-only change.', HELMET.priceYen],
    );
  }, KEN));

test('page edits: a rejected change keeps the typed draft and shows the server message', () =>
  withPage(async ({ controller, lastMessage, server$ }) => {
    await controller.reloadFresh();
    const before = card(controller, 'l2');
    controller.startEdit('l2');
    controller.updateDraft('l2', 'description', 'Typed description');
    controller.updateDraft('l2', 'priceYen', '100');

    await controller.saveEdit('l2');
    assert.deepEqual(lastMessage(), {
      text: 'priceYen must be an integer between 300 and 9999999.',
      kind: 'error',
    });
    assert.deepEqual(controller.draftFor('l2'), {
      title: HELMET.title,
      description: 'Typed description',
      priceYen: '100',
      saving: false,
    });
    assert.deepEqual(card(controller, 'l2'), before);
    assert.equal((await getListing(server$, 'l2')).updatedAt, null);

    // Fixing the value and saving again succeeds.
    controller.updateDraft('l2', 'priceYen', '3900');
    await controller.saveEdit('l2');
    assert.equal(controller.draftFor('l2'), undefined);
    assert.deepEqual(card(controller, 'l2'), { ...before, description: 'Typed description', priceYen: 3900 });
    assert.equal(lastMessage().kind, 'info');
  }, KEN));

test('page edits: an empty title is rejected with the server message', () =>
  withPage(async ({ controller, lastMessage }) => {
    await controller.reloadFresh();
    controller.startEdit('l3');
    controller.updateDraft('l3', 'title', '');
    controller.updateDraft('l3', 'priceYen', '7000');
    await controller.saveEdit('l3');
    assert.deepEqual(lastMessage(), { text: 'title is required.', kind: 'error' });
    assert.equal(controller.draftFor('l3').title, '');
    assert.equal(controller.draftFor('l3').priceYen, '7000');
    assert.deepEqual(card(controller, 'l3'), {
      title: 'Mechanical keyboard',
      description: card(controller, 'l3').description,
      priceYen: 7800,
    });
  }, KEN));

test('page edits: saving a listing sold meanwhile shows the server message and keeps the draft', () =>
  withPage(async ({ controller, lastMessage, server$ }) => {
    await controller.reloadFresh();
    controller.startEdit('l2');
    controller.updateDraft('l2', 'priceYen', '4000');
    await server$('POST', '/api/listings/l2/purchase', 'u1');

    await controller.saveEdit('l2');
    assert.deepEqual(lastMessage(), { text: 'This listing has already been sold.', kind: 'error' });
    assert.equal(controller.draftFor('l2').priceYen, '4000');
    assert.equal((await getListing(server$, 'l2')).priceYen, 4500);
  }, KEN));

test('page edits: a second Save or a Cancel while saving is ignored', () =>
  withPage(async ({ controller, net, mutations }) => {
    await controller.reloadFresh();
    controller.startEdit('l2');
    controller.updateDraft('l2', 'priceYen', '3900');

    const patch = net.hold('PATCH', '/api/listings/l2');
    const saving = controller.saveEdit('l2');
    await patch.answered;
    assert.equal(controller.draftFor('l2').saving, true);
    await controller.saveEdit('l2');
    controller.cancelEdit('l2');
    assert.equal(controller.draftFor('l2').saving, true);

    patch.release();
    await saving;
    assert.deepEqual(mutations(), ['PATCH /api/listings/l2']);
    assert.equal(controller.draftFor('l2'), undefined);
    assert.equal(card(controller, 'l2').priceYen, 3900);
  }, KEN));

test('page edits: Save without an open form sends nothing', () =>
  withPage(async ({ controller, mutations }) => {
    await controller.reloadFresh();
    await controller.saveEdit('l2');
    assert.deepEqual(mutations(), []);
  }, KEN));

test('page edits: the open form and typed values survive hearts, searches and reloads', () =>
  withPage(async ({ controller, filters }) => {
    await controller.reloadFresh();
    controller.startEdit('l2');
    controller.updateDraft('l2', 'title', 'Draft title');
    controller.updateDraft('l2', 'priceYen', '4100');

    await controller.toggleFavorite('l5');
    filters.q = 'e';
    await controller.loadView();
    filters.q = '';
    await controller.loadView();
    await controller.reloadFresh();
    assert.equal(controller.draftFor('l2').title, 'Draft title');
    assert.equal(controller.draftFor('l2').priceYen, '4100');
  }, KEN));

test('page edits: a draft is never shown to another user and is kept for its owner', () =>
  withPage(async ({ controller }) => {
    await controller.reloadFresh();
    controller.startEdit('l2');
    controller.updateDraft('l2', 'title', 'Ken private draft');

    await controller.setUser('u1');
    assert.equal(controller.draftFor('l2'), undefined);
    assert.equal(card(controller, 'l2').title, HELMET.title);

    await controller.setUser('u2');
    assert.equal(controller.draftFor('l2').title, 'Ken private draft');
  }, KEN));

test("page edits: a save that settles after a user switch leaves the new user's page alone", () =>
  withPage(async ({ controller, net, messages, server$ }) => {
    await controller.reloadFresh();
    controller.startEdit('l2');
    controller.updateDraft('l2', 'priceYen', '3900');

    const patch = net.hold('PATCH', '/api/listings/l2');
    const saving = controller.saveEdit('l2');
    await patch.answered;
    await controller.setUser('u1');
    const shownToHana = controller.state.listings;
    const requestsAfterSwitch = net.log.length;
    const messagesAfterSwitch = messages.length;

    patch.release();
    await saving;
    assert.equal(controller.state.listings, shownToHana);
    assert.equal(net.log.length, requestsAfterSwitch);
    assert.equal(messages.length, messagesAfterSwitch);
    assert.equal((await getListing(server$, 'l2')).priceYen, 3900);

    // The saved draft is closed for Ken too.
    await controller.setUser('u2');
    assert.equal(controller.draftFor('l2'), undefined);
    assert.equal(card(controller, 'l2').priceYen, 3900);
  }, KEN));

test('page edits: a rejection that settles after a user switch keeps the draft for its owner only', () =>
  withPage(async ({ controller, net, messages }) => {
    await controller.reloadFresh();
    controller.startEdit('l2');
    controller.updateDraft('l2', 'priceYen', '100');

    const patch = net.hold('PATCH', '/api/listings/l2');
    const saving = controller.saveEdit('l2');
    await patch.answered;
    await controller.setUser('u1');
    const messagesAfterSwitch = messages.length;

    patch.release();
    await saving;
    assert.equal(messages.length, messagesAfterSwitch);
    assert.equal(controller.draftFor('l2'), undefined);

    await controller.setUser('u2');
    assert.deepEqual(controller.draftFor('l2'), {
      title: HELMET.title,
      description: controller.state.listings.find((l) => l.id === 'l2').description,
      priceYen: '100',
      saving: false,
    });
  }, KEN));

test('page edits: other users see the edited values', () =>
  withPage(async ({ controller }) => {
    await controller.reloadFresh();
    controller.startEdit('l3');
    controller.updateDraft('l3', 'title', 'Mechanical keyboard (TKL)');
    controller.updateDraft('l3', 'priceYen', '7200');
    await controller.saveEdit('l3');

    for (const user of ['u1', 'u3']) {
      await controller.setUser(user);
      assert.equal(card(controller, 'l3').title, 'Mechanical keyboard (TKL)');
      assert.equal(card(controller, 'l3').priceYen, 7200);
    }
  }, KEN));
