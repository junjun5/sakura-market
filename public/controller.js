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
import { canManage, draftFrom, editBody, isEditField, replaceListing } from './listing-actions.js';

/**
 * @typedef {import('./favorites-state.js').ClientListing} ClientListing
 * @typedef {import('./favorites-state.js').FavoriteState} FavoriteState
 * @typedef {import('./listing-actions.js').EditDraft} EditDraft
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
   *   editing: Map<string, EditDraft>,
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
    // `${userId}:${listingId}` -> the open edit form's draft. Kept apart from the
    // listings so it survives every re-render and reload, and per user so no one
    // else sees it.
    editing: new Map(),
  };
  const loads = createLatestGate();

  /** @param {string} listingId */
  const pendingFor = (listingId) => state.pending.get(pendingKey(state.userId, listingId));
  /** @param {string} listingId */
  const draftFor = (listingId) => state.editing.get(pendingKey(state.userId, listingId));

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

  // Opening a form that is already open keeps what was typed in it.
  /** @param {string} listingId */
  function startEdit(listingId) {
    const listing = state.listings?.find((l) => l.id === listingId);
    if (!listing || !canManage(listing, state.userId) || draftFor(listingId)) return;
    state.editing.set(pendingKey(state.userId, listingId), draftFrom(listing));
    render();
  }

  // Typing only updates the draft: the field already shows the value, and a
  // render would rebuild the field under the user's cursor.
  /**
   * @param {string} listingId
   * @param {string} field
   * @param {string} value
   */
  function updateDraft(listingId, field, value) {
    const draft = draftFor(listingId);
    if (draft && isEditField(field)) draft[field] = value;
  }

  /** @param {string} listingId */
  function cancelEdit(listingId) {
    const draft = draftFor(listingId);
    if (!draft || draft.saving) return;
    state.editing.delete(pendingKey(state.userId, listingId));
    render();
  }

  /** @param {string} listingId */
  async function saveEdit(listingId) {
    const actingUserId = state.userId;
    const key = pendingKey(actingUserId, listingId);
    const draft = state.editing.get(key);
    if (!draft || draft.saving) return;
    draft.saving = true;
    showMessage('');
    render();

    const { updated, failure } = await sendForListing(`/api/listings/${encodeURIComponent(listingId)}`, {
      method: 'PATCH',
      userId: actingUserId,
      body: editBody(draft),
    });
    draft.saving = false;
    // A saved draft is done for its owner even if they switched away meanwhile.
    if (updated) state.editing.delete(key);
    if (state.userId !== actingUserId) return;
    if (!updated) {
      showMessage(errorMessage(failure), 'error');
      render();
      return;
    }
    state.listings = replaceListing(state.listings, updated);
    showMessage(`Saved your changes to "${updated.title}".`);
    render();
    // As after a favorite: a load still in flight may predate the edit.
    await loadView();
  }

  return {
    state,
    pendingFor,
    draftFor,
    loadView,
    reloadFresh,
    setView,
    setUser,
    toggleFavorite,
    startEdit,
    updateDraft,
    cancelEdit,
    saveEdit,
  };

  /**
   * @param {string} listingId
   * @param {boolean} save
   * @param {string} asUserId
   */
  function sendFavorite(listingId, save, asUserId) {
    return sendForListing(`/api/listings/${encodeURIComponent(listingId)}/favorite`, {
      method: save ? 'PUT' : 'DELETE',
      userId: asUserId,
    });
  }

  // Never throws: a rejected request resolves with its error as `failure`.
  /**
   * @param {string} path
   * @param {ApiOptions} options
   * @returns {Promise<{ updated: ClientListing | null, failure: unknown }>}
   */
  async function sendForListing(path, options) {
    try {
      const { listing } = await api(path, options);
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
