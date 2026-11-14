// Browser client. Plain DOM, no framework, no build step.
import { createApiClient, createController, errorMessage } from './controller.js';
import { controlButton, editForm } from './edit-form.js';
import { canFavorite } from './favorites-state.js';
import { actionFor, canManage } from './listing-actions.js';

/**
 * @typedef {import('./favorites-state.js').ClientListing} ClientListing
 * @typedef {import('./controller.js').ClientUser} ClientUser
 */

// Every selector used here names an element in index.html.
/** @param {string} selector */
const $ = (selector) => /** @type {HTMLElement} */ (document.querySelector(selector));
/** @param {string} selector */
const $input = (selector) => /** @type {HTMLInputElement} */ ($(selector));
/** @param {string} selector */
const $all = (selector) => /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(selector));

const api = createApiClient((url, options) => fetch(url, options));

const controller = createController({
  api,
  userId: localStorage.getItem('userId') ?? 'u1',
  filters: () => ({ q: $input('#search').value, onSale: $input('#only-on-sale').checked }),
  render,
  showMessage,
});
const { state } = controller;

/**
 * @param {string} text
 * @param {string} [kind]
 */
function showMessage(text, kind = 'info') {
  const el = $('#message');
  el.textContent = text;
  el.dataset.kind = kind;
  el.hidden = !text;
}

/** @param {string} id */
function userName(id) {
  return state.users.find((u) => u.id === id)?.name ?? id;
}

/** @param {ClientListing} listing */
function favoriteControls(listing) {
  const pending = controller.pendingFor(listing.id);
  const { savedByMe, savedCount } = pending ?? listing;

  const wrap = document.createElement('div');
  wrap.className = 'favorite';

  if (canFavorite(listing, state.userId)) {
    const heart = document.createElement('button');
    heart.type = 'button';
    heart.className = 'heart';
    heart.dataset.control = 'heart';
    heart.setAttribute('aria-label', `Save ${listing.title}`);
    heart.setAttribute('aria-pressed', String(savedByMe));
    heart.title = savedByMe ? 'Remove from saved' : 'Save';
    heart.textContent = savedByMe ? '♥' : '♡';
    heart.disabled = Boolean(pending);
    heart.addEventListener('click', () => controller.toggleFavorite(listing.id));
    wrap.append(heart);
  }

  const count = document.createElement('span');
  count.className = 'saved-count';
  count.textContent = `${savedCount} saved`;
  wrap.append(count);
  return wrap;
}

/** @param {ClientListing} listing */
function cardDetails(listing) {
  const title = document.createElement('h3');
  title.textContent = listing.title;

  const description = document.createElement('p');
  description.className = 'description';
  description.textContent = listing.description;

  const price = document.createElement('p');
  price.className = 'price';
  price.textContent = `¥${listing.priceYen.toLocaleString('en-US')}`;

  const seller = document.createElement('p');
  seller.className = 'seller';
  seller.textContent = `Seller: ${userName(listing.sellerId)}`;

  return [title, description, price, seller];
}

/** @param {ClientListing} listing */
function actionButton(listing) {
  const { label, enabled } = actionFor(listing, state.userId);
  const action = document.createElement('button');
  action.type = 'button';
  action.textContent = label;
  action.disabled = !enabled;
  if (enabled) action.addEventListener('click', () => buy(listing.id));
  return action;
}

// The closed form's buttons are gone after a render, so focus returns to Edit.
const editActions = {
  updateDraft: controller.updateDraft,
  /** @param {string} id */
  cancelEdit(id) {
    controller.cancelEdit(id);
    if (!controller.draftFor(id)) focusCardControl(id, 'edit');
  },
  /** @param {string} id */
  async saveEdit(id) {
    await controller.saveEdit(id);
    if (!controller.draftFor(id) && focusIsLost()) focusCardControl(id, 'edit');
  },
};

/** @param {string} id */
function openEdit(id) {
  controller.startEdit(id);
  focusCardControl(id, 'edit-title');
  // The form makes the card taller; keep all of it in view, Save included.
  const form = document.querySelector(`#listings [data-listing-id="${CSS.escape(id)}"] form.edit-form`);
  form?.scrollIntoView({ block: 'nearest' });
}

// Shown only on the seller's own on-sale cards: the Edit button, or the open form.
/** @param {ClientListing} listing */
function ownerControls(listing) {
  const draft = controller.draftFor(listing.id);
  if (draft) return editForm(listing, draft, editActions);
  const wrap = document.createElement('div');
  wrap.className = 'owner-actions';
  wrap.append(controlButton('Edit', 'edit', () => openEdit(listing.id)));
  return wrap;
}

/** @param {ClientListing} listing */
function listingCard(listing) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.listingId = listing.id;
  card.dataset.status = listing.status;
  card.append(...cardDetails(listing), favoriteControls(listing), actionButton(listing));
  if (canManage(listing, state.userId)) card.append(ownerControls(listing));
  return card;
}

/** @param {string} text */
function note(text) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
}

function savedEmptyState() {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const text = document.createElement('p');
  text.textContent = 'You have no saved listings yet. Press the heart on a listing to save it here.';
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Browse all listings';
  back.addEventListener('click', () => controller.setView('all'));
  wrap.append(text, back);
  return wrap;
}

function renderNav() {
  for (const tab of $all('.view-tab')) {
    if (tab.dataset.view === state.view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  const saved = state.view === 'saved';
  // Search and status filters belong to All only; their values are kept for when the user returns.
  $('#filters').hidden = saved;
  $('#view-hint').hidden = !saved;
  $('#listings').setAttribute('aria-label', saved ? 'Saved listings' : 'Listings');
}

// Cards are rebuilt on every render, so a focused heart would otherwise drop
// focus to the page. A settled toggle also reclaims focus its disabled
// in-flight heart lost, unless the user has since focused something else.
/** @param {{ settledListingId?: string }} [options] */
function focusTarget({ settledListingId } = {}) {
  const active = /** @type {HTMLElement | null} */ (document.activeElement);
  const focused = focusedCardControl(active);
  if (focused) return focused;
  return focusIsLost() && settledListingId ? { listingId: settledListingId, control: 'heart' } : null;
}

/** @param {HTMLElement | null} active */
function focusedCardControl(active) {
  const control = active?.dataset?.control;
  if (!active || !control) return null;
  const card = /** @type {HTMLElement | null} */ (active.closest('#listings [data-listing-id]'));
  const listingId = card?.dataset.listingId;
  return listingId ? { listingId, control } : null;
}

function focusIsLost() {
  return !document.activeElement || document.activeElement === document.body;
}

/**
 * @param {string} listingId
 * @param {string} control
 */
function focusCardControl(listingId, control) {
  const selector = `[data-listing-id="${CSS.escape(listingId)}"] [data-control="${control}"]`;
  /** @type {HTMLElement | null} */ ($('#listings').querySelector(selector))?.focus();
}

/** @param {{ settledListingId?: string }} [options] */
function render(options) {
  const target = focusTarget(options);
  renderNav();
  const container = $('#listings');
  if (state.listings === null) {
    container.replaceChildren(note(state.loadFailed ? 'Could not load listings.' : 'Loading…'));
  } else if (state.listings.length === 0) {
    container.replaceChildren(state.view === 'saved' ? savedEmptyState() : note('No listings found.'));
  } else {
    container.replaceChildren(...state.listings.map(listingCard));
  }
  if (target) focusCardControl(target.listingId, target.control);
}

/** @param {string} id */
async function buy(id) {
  const userId = state.userId;
  try {
    const { listing } = await api(`/api/listings/${id}/purchase`, { method: 'POST', userId });
    if (state.userId === userId) showMessage(`You bought "${listing.title}".`);
  } catch (err) {
    if (state.userId === userId) showMessage(errorMessage(err), 'error');
  }
  await controller.loadView();
}

/** @param {SubmitEvent} event */
async function sell(event) {
  event.preventDefault();
  const form = /** @type {HTMLFormElement} */ (event.currentTarget);
  const data = new FormData(form);
  const userId = state.userId;
  try {
    const { listing } = await api('/api/listings', {
      method: 'POST',
      userId,
      body: {
        title: data.get('title'),
        description: data.get('description'),
        priceYen: Number(data.get('priceYen')),
      },
    });
    form.reset();
    if (state.userId === userId) showMessage(`Listed "${listing.title}".`);
  } catch (err) {
    if (state.userId === userId) showMessage(errorMessage(err), 'error');
  }
  await controller.loadView();
}

async function init() {
  const { users } = /** @type {{ users: ClientUser[] }} */ (
    await api('/api/users', { userId: state.userId })
  );
  state.users = users;
  if (!users.some((u) => u.id === state.userId)) state.userId = users[0].id;

  const select = /** @type {HTMLSelectElement} */ ($('#user-select'));
  for (const user of users) {
    const option = new Option(user.name, user.id, false, user.id === state.userId);
    select.add(option);
  }
  select.addEventListener('change', () => {
    localStorage.setItem('userId', select.value);
    controller.setUser(select.value);
  });

  for (const tab of $all('.view-tab')) {
    tab.addEventListener('click', () => controller.setView(tab.dataset.view ?? 'all'));
  }
  $('#search').addEventListener('input', () => controller.loadView());
  $('#only-on-sale').addEventListener('change', () => controller.loadView());
  $('#sell-form').addEventListener('submit', sell);

  await controller.reloadFresh();
}

init().catch((err) => showMessage(errorMessage(err), 'error'));
