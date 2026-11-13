// Browser client. Plain DOM, no framework, no build step.
import {
  applyFavoriteResult,
  canFavorite,
  createLatestGate,
  listingsPath,
  optimisticFavorite,
} from './favorites-state.js';

const $ = (selector) => document.querySelector(selector);

const state = {
  users: [],
  userId: localStorage.getItem('userId') ?? 'u1',
  view: 'all',
  // Listings shown in the current view for the current user; null while loading.
  listings: null,
  loadFailed: false,
  // `${userId}:${listingId}` -> optimistic { savedByMe, savedCount } of an in-flight toggle.
  pending: new Map(),
};

const loads = createLatestGate();

async function api(path, { method = 'GET', body, userId = state.userId } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'x-user-id': userId,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? 'Request failed.');
  return data;
}

function showMessage(text, kind = 'info') {
  const el = $('#message');
  el.textContent = text;
  el.dataset.kind = kind;
  el.hidden = !text;
}

function userName(id) {
  return state.users.find((u) => u.id === id)?.name ?? id;
}

const pendingKey = (userId, listingId) => `${userId}:${listingId}`;

function favoriteControls(listing) {
  const pending = state.pending.get(pendingKey(state.userId, listing.id));
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
    heart.addEventListener('click', () => toggleFavorite(listing.id));
    wrap.append(heart);
  }

  const count = document.createElement('span');
  count.className = 'saved-count';
  count.textContent = `${savedCount} saved`;
  wrap.append(count);
  return wrap;
}

function listingCard(listing) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.listingId = listing.id;
  card.dataset.status = listing.status;

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

  const action = document.createElement('button');
  action.type = 'button';
  if (listing.status === 'sold') {
    action.textContent = 'Sold';
    action.disabled = true;
  } else if (listing.sellerId === state.userId) {
    action.textContent = 'Your listing';
    action.disabled = true;
  } else {
    action.textContent = 'Buy';
    action.addEventListener('click', () => buy(listing.id));
  }

  card.append(title, description, price, seller, favoriteControls(listing), action);
  return card;
}

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
  back.addEventListener('click', () => setView('all'));
  wrap.append(text, back);
  return wrap;
}

function renderNav() {
  for (const tab of document.querySelectorAll('.view-tab')) {
    if (tab.dataset.view === state.view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  const saved = state.view === 'saved';
  // Search and status filters belong to All only; their values are kept for when the user returns.
  $('#filters').hidden = saved;
  $('#view-hint').hidden = !saved;
  $('#listings').setAttribute('aria-label', saved ? 'Saved listings' : 'Listings');
}

function render() {
  renderNav();
  const container = $('#listings');
  if (state.listings === null) {
    container.replaceChildren(note(state.loadFailed ? 'Could not load listings.' : 'Loading…'));
  } else if (state.listings.length === 0) {
    container.replaceChildren(state.view === 'saved' ? savedEmptyState() : note('No listings found.'));
  } else {
    container.replaceChildren(...state.listings.map(listingCard));
  }
}

async function loadView() {
  const ticket = loads.next();
  const path = listingsPath(state.view, { q: $('#search').value, onSale: $('#only-on-sale').checked });
  try {
    const { listings } = await api(path);
    if (!loads.isCurrent(ticket)) return;
    state.listings = listings;
    state.loadFailed = false;
  } catch (err) {
    if (!loads.isCurrent(ticket)) return;
    state.loadFailed = true;
    showMessage(err.message, 'error');
  }
  render();
}

// Clears the shown cards first so the previous user's or view's listings can
// neither be seen nor pressed while the new ones load.
function reloadFresh() {
  state.listings = null;
  state.loadFailed = false;
  render();
  return loadView();
}

function setView(view) {
  state.view = view;
  showMessage('');
  reloadFresh();
}

async function toggleFavorite(listingId) {
  const userId = state.userId;
  const key = pendingKey(userId, listingId);
  const listing = state.listings?.find((l) => l.id === listingId);
  if (!listing || state.pending.has(key) || !canFavorite(listing, userId)) return;

  const prior = { id: listingId, savedByMe: listing.savedByMe, savedCount: listing.savedCount };
  const next = optimisticFavorite(listing);
  const loadsBefore = loads.current();
  state.pending.set(key, next);
  showMessage('');
  render();

  let updated = null;
  let failure = null;
  try {
    ({ listing: updated } = await api(`/api/listings/${encodeURIComponent(listingId)}/favorite`, {
      method: next.savedByMe ? 'PUT' : 'DELETE',
      userId,
    }));
  } catch (err) {
    failure = err;
  }
  state.pending.delete(key);
  // The result belongs to `userId` only; it must not touch another user's page.
  if (state.userId !== userId) return;

  state.listings = applyFavoriteResult(state.listings, updated ?? prior, state.view);
  if (failure) showMessage(failure.message, 'error');
  const focusLost = !document.activeElement || document.activeElement === document.body;
  render();
  if (focusLost) document.querySelector(`[data-listing-id="${CSS.escape(listingId)}"] .heart`)?.focus();
  // A load that ran during the request may hold pre-mutation data, or the view changed: fetch again.
  if (loads.current() !== loadsBefore) loadView();
}

async function buy(id) {
  const userId = state.userId;
  try {
    const { listing } = await api(`/api/listings/${id}/purchase`, { method: 'POST', userId });
    if (state.userId === userId) showMessage(`You bought "${listing.title}".`);
  } catch (err) {
    if (state.userId === userId) showMessage(err.message, 'error');
  }
  await loadView();
}

async function sell(event) {
  event.preventDefault();
  const form = event.currentTarget;
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
    if (state.userId === userId) showMessage(err.message, 'error');
  }
  await loadView();
}

async function init() {
  const { users } = await api('/api/users');
  state.users = users;
  if (!users.some((u) => u.id === state.userId)) state.userId = users[0].id;

  const select = $('#user-select');
  for (const user of users) {
    const option = new Option(user.name, user.id, false, user.id === state.userId);
    select.add(option);
  }
  select.addEventListener('change', () => {
    state.userId = select.value;
    localStorage.setItem('userId', state.userId);
    showMessage('');
    reloadFresh();
  });

  for (const tab of document.querySelectorAll('.view-tab')) {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  }
  $('#search').addEventListener('input', loadView);
  $('#only-on-sale').addEventListener('change', loadView);
  $('#sell-form').addEventListener('submit', sell);

  await reloadFresh();
}

init().catch((err) => showMessage(err.message, 'error'));
