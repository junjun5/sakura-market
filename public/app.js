// Browser client. Plain DOM, no framework, no build step.
import { createApiClient, createController } from './controller.js';
import { canFavorite } from './favorites-state.js';

const $ = (selector) => document.querySelector(selector);

const api = createApiClient((...args) => fetch(...args));

const controller = createController({
  api,
  userId: localStorage.getItem('userId') ?? 'u1',
  filters: () => ({ q: $('#search').value, onSale: $('#only-on-sale').checked }),
  render,
  showMessage,
});
const { state } = controller;

function showMessage(text, kind = 'info') {
  const el = $('#message');
  el.textContent = text;
  el.dataset.kind = kind;
  el.hidden = !text;
}

function userName(id) {
  return state.users.find((u) => u.id === id)?.name ?? id;
}

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
  back.addEventListener('click', () => controller.setView('all'));
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

// Cards are rebuilt on every render, so a focused heart would otherwise drop
// focus to the page. A settled toggle also reclaims focus its disabled
// in-flight heart lost, unless the user has since focused something else.
function focusTarget({ settledListingId } = {}) {
  const active = document.activeElement;
  const card = active?.dataset?.control ? active.closest('#listings [data-listing-id]') : null;
  if (card) return { listingId: card.dataset.listingId, control: active.dataset.control };
  const focusLost = !active || active === document.body;
  if (focusLost && settledListingId) return { listingId: settledListingId, control: 'heart' };
  return null;
}

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
  if (target) {
    container
      .querySelector(`[data-listing-id="${CSS.escape(target.listingId)}"] [data-control="${target.control}"]`)
      ?.focus();
  }
}

async function buy(id) {
  const userId = state.userId;
  try {
    const { listing } = await api(`/api/listings/${id}/purchase`, { method: 'POST', userId });
    if (state.userId === userId) showMessage(`You bought "${listing.title}".`);
  } catch (err) {
    if (state.userId === userId) showMessage(err.message, 'error');
  }
  await controller.loadView();
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
  await controller.loadView();
}

async function init() {
  const { users } = await api('/api/users', { userId: state.userId });
  state.users = users;
  if (!users.some((u) => u.id === state.userId)) state.userId = users[0].id;

  const select = $('#user-select');
  for (const user of users) {
    const option = new Option(user.name, user.id, false, user.id === state.userId);
    select.add(option);
  }
  select.addEventListener('change', () => {
    localStorage.setItem('userId', select.value);
    controller.setUser(select.value);
  });

  for (const tab of document.querySelectorAll('.view-tab')) {
    tab.addEventListener('click', () => controller.setView(tab.dataset.view));
  }
  $('#search').addEventListener('input', () => controller.loadView());
  $('#only-on-sale').addEventListener('change', () => controller.loadView());
  $('#sell-form').addEventListener('submit', sell);

  await controller.reloadFresh();
}

init().catch((err) => showMessage(err.message, 'error'));
