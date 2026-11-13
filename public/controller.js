// Page state and the ordering of listing loads and favorite mutations. No DOM
// here: app.js supplies rendering and messages, so the same orchestration the
// page runs can be exercised with node:test against a real server.
import {
  applyFavoriteResult,
  canFavorite,
  createLatestGate,
  listingsPath,
  optimisticFavorite,
} from './favorites-state.js';

export function createApiClient(fetchImpl, baseUrl = '') {
  return async function api(path, { method = 'GET', body, userId } = {}) {
    const res = await fetchImpl(baseUrl + path, {
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
  };
}

export const pendingKey = (userId, listingId) => `${userId}:${listingId}`;

// `filters()` returns the All view's current { q, onSale }. `render(options)`
// redraws from `state`; after a favorite settles it receives the listing id so
// the page can return keyboard focus to that heart.
export function createController({ api, userId, filters, render, showMessage }) {
  const state = {
    users: [],
    userId,
    view: 'all',
    // Listings shown in the current view for the current user; null while loading.
    listings: null,
    loadFailed: false,
    // `${userId}:${listingId}` -> optimistic { savedByMe, savedCount } of an in-flight toggle.
    pending: new Map(),
  };
  const loads = createLatestGate();

  const pendingFor = (listingId) => state.pending.get(pendingKey(state.userId, listingId));

  async function loadView() {
    const ticket = loads.next();
    const path = listingsPath(state.view, filters());
    try {
      const { listings } = await api(path, { userId: state.userId });
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
    return reloadFresh();
  }

  function setUser(nextUserId) {
    state.userId = nextUserId;
    showMessage('');
    return reloadFresh();
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
    render({ settledListingId: listingId });
    // Any load still in flight may have been answered before this mutation, even
    // one that started before it, so a success always supersedes them with a
    // fresh load. After a failure only a load started meanwhile (a new filter or
    // view) needs replacing; an older one already reflects the unchanged server.
    if (updated || loads.current() !== loadsBefore) await loadView();
  }

  return { state, pendingFor, loadView, reloadFresh, setView, setUser, toggleFavorite };
}
