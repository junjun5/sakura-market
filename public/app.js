// Browser client. Plain DOM, no framework, no build step.
const $ = (selector) => document.querySelector(selector);

const state = {
  users: [],
  userId: localStorage.getItem('userId') ?? 'u1',
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'x-user-id': state.userId,
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

  card.append(title, description, price, seller, action);
  return card;
}

async function refresh() {
  const params = new URLSearchParams();
  const q = $('#search').value.trim();
  if (q) params.set('q', q);
  if ($('#only-on-sale').checked) params.set('status', 'on_sale');

  const { listings } = await api(`/api/listings?${params}`);
  const container = $('#listings');
  container.replaceChildren(...listings.map(listingCard));
  if (listings.length === 0) container.textContent = 'No listings found.';
}

async function buy(id) {
  try {
    const { listing } = await api(`/api/listings/${id}/purchase`, { method: 'POST' });
    showMessage(`You bought "${listing.title}".`);
  } catch (err) {
    showMessage(err.message, 'error');
  }
  await refresh();
}

async function sell(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    const { listing } = await api('/api/listings', {
      method: 'POST',
      body: {
        title: data.get('title'),
        description: data.get('description'),
        priceYen: Number(data.get('priceYen')),
      },
    });
    form.reset();
    showMessage(`Listed "${listing.title}".`);
  } catch (err) {
    showMessage(err.message, 'error');
  }
  await refresh();
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
    refresh();
  });

  $('#search').addEventListener('input', refresh);
  $('#only-on-sale').addEventListener('change', refresh);
  $('#sell-form').addEventListener('submit', sell);

  await refresh();
}

init().catch((err) => showMessage(err.message, 'error'));
