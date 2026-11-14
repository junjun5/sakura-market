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

/**
 * @typedef {import('./favorites-state.js').ClientListing} ClientListing
 * @typedef {import('./favorites-state.js').FavoriteState} FavoriteState
 * @typedef {{ id: string, name: string }} ClientUser
 * @typedef {{ method?: string, body?: unknown, userId?: string }} ApiOptions
 * @typedef {(path: string, options?: ApiOptions) => Promise<any>} Api resolves with the parsed JSON body
 * @typedef {(url: string, init: { method: string, headers: Record<string, string>, body?: string }) => Promise<Response>} FetchLike
 */

/**
 * @param {FetchLike} fetchImpl
 * @param {string} [baseUrl]
 * @returns {Api}
 */
export function createApiClient(fetchImpl, baseUrl = '') {
  return async function api(path, { method = 'GET', body, userId } = {}) {
    const res = await fetchImpl(baseUrl + path, {
      method,
      headers: {
        ...(userId ? { 'x-user-id': userId } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? 'Request failed.');
    return data;
  };
}

/**
 * @param {string} userId
 * @param {string} listingId
 */
export const pendingKey = (userId, listingId) => `${userId}:${listingId}`;

// `filters()` returns the All view's current { q, onSale }. `render(options)`
// redraws from `state`; after a favorite settles it receives the listing id so
// the page can return keyboard focus to that heart.
/**
 * @param {{
 *   api: Api,
 *   userId: string,
 *   filters: () => { q?: string, onSale?: boolean },
 *   render: (options?: { settledListingId?: string }) => void,
 *   showMessage: (text: string, kind?: string) => void,
 * }} options
 */
export function createController({ api, userId, filters, render, showMessage }) {
  /**
   * @type {{
   *   users: ClientUser[],
   *   userId: string,
   *   view: string,
   *   listings: ClientListing[] | null,
   *   loadFailed: boolean,
   *   pending: Map<string, FavoriteState>,
   * }}
   */
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

  /** @param {string} listingId */
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
      showMessage(errorMessage(err), 'error');
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

  /** @param {string} view */
  function setView(view) {
    state.view = view;
    showMessage('');
    return reloadFresh();
  }

  /** @param {string} nextUserId */
  function setUser(nextUserId) {
    state.userId = nextUserId;
    showMessage('');
    return reloadFresh();
  }

  /** @param {string} listingId */
  async function toggleFavorite(listingId) {
    const actingUserId = state.userId;
    const key = pendingKey(actingUserId, listingId);
    const listing = state.listings?.find((l) => l.id === listingId);
    if (!listing || state.pending.has(key) || !canFavorite(listing, actingUserId)) return;

    const prior = { id: listingId, savedByMe: listing.savedByMe, savedCount: listing.savedCount };
    const next = optimisticFavorite(listing);
    const loadsBefore = loads.current();
    state.pending.set(key, next);
    showMessage('');
    render();

    const { updated, failure } = await sendFavorite(listingId, next.savedByMe, actingUserId);
    state.pending.delete(key);
    // The result belongs to `actingUserId` only; it must not touch another user's page.
    if (state.userId !== actingUserId) return;

    state.listings = applyFavoriteResult(state.listings, updated ?? prior, state.view);
    if (failure) showMessage(errorMessage(failure), 'error');
    render({ settledListingId: listingId });
    // Any load still in flight may have been answered before this mutation, even
    // one that started before it, so a success always supersedes them with a
    // fresh load. After a failure only a load started meanwhile (a new filter or
    // view) needs replacing; an older one already reflects the unchanged server.
    if (updated || loads.current() !== loadsBefore) await loadView();
  }

  return { state, pendingFor, loadView, reloadFresh, setView, setUser, toggleFavorite };

  /**
   * @param {string} listingId
   * @param {boolean} save
   * @param {string} asUserId
   * @returns {Promise<{ updated: ClientListing | null, failure: unknown }>}
   */
  async function sendFavorite(listingId, save, asUserId) {
    try {
      const { listing } = await api(`/api/listings/${encodeURIComponent(listingId)}/favorite`, {
        method: save ? 'PUT' : 'DELETE',
        userId: asUserId,
      });
      return { updated: listing, failure: null };
    } catch (err) {
      return { updated: null, failure: err };
    }
  }
}

/** @param {unknown} err */
export function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
