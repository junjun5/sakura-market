// Pure helpers for the browser client's Favorites state. No DOM here, so the
// rules can be tested with node:test.

export const VIEWS = ['all', 'saved'];

// Hands out increasing tickets. Only a response holding the newest ticket may
// render, so a late answer for an old user, view or filter is dropped.
export function createLatestGate() {
  let latest = 0;
  return {
    next: () => ++latest,
    current: () => latest,
    isCurrent: (ticket) => ticket === latest,
  };
}

// Saved is the caller's whole saved list: the All view's search and status
// filters never apply to it.
export function listingsPath(view, { q = '', onSale = false } = {}) {
  if (view === 'saved') return '/api/me/favorites';
  const params = new URLSearchParams();
  const query = q.trim();
  if (query) params.set('q', query);
  if (onSale) params.set('status', 'on_sale');
  return `/api/listings?${params}`;
}

export function canFavorite(listing, userId) {
  return listing.sellerId !== userId;
}

export function optimisticFavorite(listing) {
  const savedByMe = !listing.savedByMe;
  const savedCount = Math.max(0, listing.savedCount + (savedByMe ? 1 : -1));
  return { savedByMe, savedCount };
}

// Merges a favorite mutation result into the shown listings. In Saved, a
// listing the user no longer saves leaves the view.
export function applyFavoriteResult(listings, updated, view) {
  if (!listings) return listings;
  if (!listings.some((listing) => listing.id === updated.id)) return listings;
  if (view === 'saved' && !updated.savedByMe) {
    return listings.filter((listing) => listing.id !== updated.id);
  }
  return listings.map((listing) => (listing.id === updated.id ? { ...listing, ...updated } : listing));
}
