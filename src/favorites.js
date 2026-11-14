// Business rules for favorites (saved listings). No HTTP here: functions take
// plain values and throw AppError when a rule is broken.
import { conflict, notFound } from './errors.js';

/**
 * @typedef {import('./store.js').Store} Store
 * @typedef {import('./store.js').User} User
 * @typedef {import('./store.js').Listing} Listing
 * @typedef {Listing & { savedCount: number, savedByMe: boolean }} DecoratedListing
 */

export const MAX_FAVORITES = 100;

/**
 * @param {Store} store
 * @param {{ now?: () => Date }} [options]
 */
export function createFavoriteService(store, { now = () => new Date() } = {}) {
  /** @param {string} id */
  function getListing(id) {
    const listing = store.getListing(id);
    if (!listing) throw notFound('listing_not_found', `Listing ${id} does not exist.`);
    return listing;
  }

  // Adds the public saved count and whether `viewer` (a user or null) saved it.
  /**
   * @param {Listing} listing
   * @param {{ id?: string } | null | undefined} viewer
   * @returns {DecoratedListing}
   */
  function decorate(listing, viewer) {
    return {
      ...listing,
      savedCount: store.countFavoritesForListing(listing.id),
      savedByMe: viewer?.id ? store.getFavorite(viewer.id, listing.id) !== null : false,
    };
  }

  /**
   * @param {Listing[]} listings
   * @param {{ id?: string } | null | undefined} viewer
   */
  function decorateAll(listings, viewer) {
    return listings.map((listing) => decorate(listing, viewer));
  }

  /**
   * @param {User} user
   * @param {string} listingId
   */
  function save(user, listingId) {
    const listing = getListing(listingId);
    if (listing.sellerId === user.id) {
      throw conflict('own_listing', 'You cannot save your own listing.');
    }
    // Checked before the limit so a repeated save at capacity still succeeds.
    if (store.getFavorite(user.id, listingId)) return decorate(listing, user);
    if (store.countFavoritesByUser(user.id) >= MAX_FAVORITES) {
      throw conflict(
        'favorites_limit_reached',
        `You can save at most ${MAX_FAVORITES} listings. Remove one before saving another.`,
      );
    }
    store.insertFavorite({ userId: user.id, listingId, savedAt: now().toISOString() });
    return decorate(listing, user);
  }

  /**
   * @param {User} user
   * @param {string} listingId
   */
  function remove(user, listingId) {
    const listing = getListing(listingId);
    store.deleteFavorite(user.id, listingId);
    return decorate(listing, user);
  }

  // The caller's saved listings with live listing data, most recently saved first.
  /** @param {User} user */
  function listSaved(user) {
    return store
      .listFavoritesByUser(user.id)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.sequence - a.sequence)
      .map((favorite) => store.getListing(favorite.listingId))
      .filter((listing) => listing !== null)
      .map((listing) => decorate(listing, user));
  }

  return { save, remove, listSaved, decorate, decorateAll };
}
