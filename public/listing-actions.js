// Pure helpers for a card's actions and the seller's edit form. No DOM here,
// so the rules can be tested with node:test.

/**
 * @typedef {import('./favorites-state.js').ClientListing} ClientListing
 * @typedef {'title' | 'description' | 'priceYen'} EditField
 * @typedef {{ title: string, description: string, priceYen: string, saving: boolean }} EditDraft
 *   An open edit form. `priceYen` is the price field's text as typed.
 */

/** @type {readonly EditField[]} */
const EDIT_FIELDS = ['title', 'description', 'priceYen'];

// Edit (and Withdraw) appear only on the seller's own listings that are on sale.
/**
 * @param {{ sellerId: string, status: string }} listing
 * @param {string} userId
 */
export function canManage(listing, userId) {
  return listing.sellerId === userId && listing.status === 'on_sale';
}

/**
 * @param {{ sellerId: string, status: string }} listing
 * @param {string} userId
 * @returns {{ label: string, enabled: boolean }} the card's main button; only Buy is enabled
 */
export function actionFor(listing, userId) {
  if (listing.status === 'sold') return { label: 'Sold', enabled: false };
  if (listing.status === 'withdrawn') return { label: 'Withdrawn', enabled: false };
  if (listing.sellerId === userId) return { label: 'Your listing', enabled: false };
  return { label: 'Buy', enabled: true };
}

/**
 * @param {{ title: string, description: string, priceYen: number }} listing
 * @returns {EditDraft}
 */
export function draftFrom(listing) {
  return {
    title: listing.title,
    description: listing.description,
    priceYen: String(listing.priceYen),
    saving: false,
  };
}

/**
 * @param {string} field
 * @returns {field is EditField}
 */
export function isEditField(field) {
  return /** @type {readonly string[]} */ (EDIT_FIELDS).includes(field);
}

// Sends every field as typed: the server validates them and its message is
// shown when it rejects one. A price that is not a number reaches it as null.
/** @param {EditDraft} draft */
export function editBody(draft) {
  return { title: draft.title, description: draft.description, priceYen: Number(draft.priceYen) };
}

/**
 * @template {{ id: string }} T
 * @param {T[] | null} listings
 * @param {T} updated
 * @returns {T[] | null}
 */
export function replaceListing(listings, updated) {
  if (!listings?.some((listing) => listing.id === updated.id)) return listings;
  return listings.map((listing) => (listing.id === updated.id ? { ...listing, ...updated } : listing));
}
