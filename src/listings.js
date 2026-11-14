// Business rules for listings. No HTTP here: functions take plain values and
// throw AppError when a rule is broken.
import { badRequest, conflict, notFound } from './errors.js';

/**
 * @typedef {import('./store.js').Store} Store
 * @typedef {import('./store.js').User} User
 * @typedef {import('./store.js').Listing} Listing
 */

export const MAX_TITLE_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 1000;
export const MIN_PRICE_YEN = 300;
export const MAX_PRICE_YEN = 9_999_999;
/** @type {readonly string[]} */
export const STATUSES = ['on_sale', 'sold'];

/**
 * @param {Store} store
 * @param {{ now?: () => Date }} [options]
 */
export function createListingService(store, { now = () => new Date() } = {}) {
  /** @param {{ status?: string, q?: string }} [filters] */
  function list({ status, q } = {}) {
    if (status !== undefined && !STATUSES.includes(status)) {
      throw badRequest('invalid_status', `status must be one of: ${STATUSES.join(', ')}.`);
    }
    const needle = (q ?? '').trim().toLowerCase();
    return store
      .listListings()
      .filter((l) => (status ? l.status === status : true))
      .filter((l) => (needle ? l.title.toLowerCase().includes(needle) : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** @param {string} id */
  function get(id) {
    const listing = store.getListing(id);
    if (!listing) throw notFound('listing_not_found', `Listing ${id} does not exist.`);
    return listing;
  }

  /**
   * @param {User} user
   * @param {unknown} input request body; anything that is not an object has no fields
   */
  function create(user, input) {
    const fields = /** @type {Record<string, unknown>} */ (
      typeof input === 'object' && input !== null ? input : {}
    );
    const title = trimmedText(fields.title);
    const description = trimmedText(fields.description);
    const priceYen = fields.priceYen;

    if (!title) throw badRequest('invalid_title', 'title is required.');
    if (title.length > MAX_TITLE_LENGTH) {
      throw badRequest('invalid_title', `title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw badRequest(
        'invalid_description',
        `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
      );
    }
    if (!isValidPrice(priceYen)) {
      throw badRequest(
        'invalid_price',
        `priceYen must be an integer between ${MIN_PRICE_YEN} and ${MAX_PRICE_YEN}.`,
      );
    }

    return store.insertListing({
      title,
      description,
      priceYen,
      sellerId: user.id,
      status: 'on_sale',
      buyerId: null,
      createdAt: now().toISOString(),
    });
  }

  /**
   * @param {User} user
   * @param {string} id
   */
  function purchase(user, id) {
    const listing = get(id);
    if (listing.sellerId === user.id) {
      throw conflict('own_listing', 'You cannot buy your own listing.');
    }
    if (listing.status !== 'on_sale') {
      throw conflict('already_sold', 'This listing has already been sold.');
    }
    // get() above has already proved the listing exists.
    return /** @type {Listing} */ (store.updateListing(id, { status: 'sold', buyerId: user.id }));
  }

  return { list, get, create, purchase };
}

/** @param {unknown} value a string is trimmed; anything else counts as empty */
function trimmedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isValidPrice(value) {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= MIN_PRICE_YEN && value <= MAX_PRICE_YEN
  );
}
