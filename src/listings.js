// Business rules for listings. No HTTP here: functions take plain values and
// throw AppError when a rule is broken.
import { badRequest, conflict, forbidden, notFound } from './errors.js';

/**
 * @typedef {import('./store.js').Store} Store
 * @typedef {import('./store.js').User} User
 * @typedef {import('./store.js').Listing} Listing
 * @typedef {'title' | 'description' | 'priceYen'} EditableField
 * @typedef {Partial<Pick<Listing, EditableField>>} ListingChanges
 */

export const MAX_TITLE_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 1000;
export const MIN_PRICE_YEN = 300;
export const MAX_PRICE_YEN = 9_999_999;
/** @type {readonly string[]} */
export const STATUSES = ['on_sale', 'sold', 'withdrawn'];
// The statuses `list()` can filter by.
/** @type {readonly string[]} */
export const LIST_STATUSES = ['on_sale', 'sold'];
/** @type {readonly EditableField[]} */
export const EDITABLE_FIELDS = ['title', 'description', 'priceYen'];

/** @type {{ [F in EditableField]: (value: unknown) => Listing[F] }} */
const FIELD_VALIDATORS = {
  title: validateTitle,
  description: validateDescription,
  priceYen: validatePrice,
};

/**
 * @param {Store} store
 * @param {{ now?: () => Date }} [options]
 */
export function createListingService(store, { now = () => new Date() } = {}) {
  /** @param {{ status?: string, q?: string }} [filters] */
  function list({ status, q } = {}) {
    if (status !== undefined && !LIST_STATUSES.includes(status)) {
      throw badRequest('invalid_status', `status must be one of: ${LIST_STATUSES.join(', ')}.`);
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
    const fields = asFields(input);
    const title = validateTitle(fields.title);
    const description = validateDescription(fields.description);
    const priceYen = validatePrice(fields.priceYen);

    return store.insertListing({
      title,
      description,
      priceYen,
      sellerId: user.id,
      status: 'on_sale',
      buyerId: null,
      createdAt: now().toISOString(),
      updatedAt: null,
    });
  }

  /**
   * Changes the editable fields present in `input`; every other field is ignored.
   * @param {User} user
   * @param {string} id
   * @param {unknown} input request body; anything that is not an object has no fields
   */
  function edit(user, id, input) {
    const listing = get(id);
    assertSeller(listing, user);
    assertOnSale(listing);
    const changes = validateChanges(asFields(input));
    // get() above has already proved the listing exists.
    return /** @type {Listing} */ (store.updateListing(id, { ...changes, updatedAt: now().toISOString() }));
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
    if (listing.status !== 'on_sale') throw alreadySold();
    // get() above has already proved the listing exists.
    return /** @type {Listing} */ (store.updateListing(id, { status: 'sold', buyerId: user.id }));
  }

  return { list, get, create, edit, purchase };
}

/**
 * @param {Listing} listing
 * @param {User} user
 */
function assertSeller(listing, user) {
  if (listing.sellerId !== user.id) {
    throw forbidden('not_seller', 'Only the seller can change this listing.');
  }
}

/** @param {Listing} listing */
function assertOnSale(listing) {
  if (listing.status === 'sold') throw alreadySold();
  if (listing.status === 'withdrawn') {
    throw conflict('listing_withdrawn', 'This listing has been withdrawn.');
  }
}

function alreadySold() {
  return conflict('already_sold', 'This listing has already been sold.');
}

/** @param {unknown} input */
function asFields(input) {
  return /** @type {Record<string, unknown>} */ (typeof input === 'object' && input !== null ? input : {});
}

// Validates every present field before returning, so one bad field means no change at all.
/**
 * @param {Record<string, unknown>} fields
 * @returns {ListingChanges}
 */
function validateChanges(fields) {
  const present = EDITABLE_FIELDS.filter((field) => Object.hasOwn(fields, field));
  if (present.length === 0) {
    throw badRequest('no_changes', 'Provide at least one of title, description or priceYen.');
  }
  return Object.fromEntries(present.map((field) => [field, FIELD_VALIDATORS[field](fields[field])]));
}

/** @param {unknown} value */
function validateTitle(value) {
  const title = trimmedText(value);
  if (!title) throw badRequest('invalid_title', 'title is required.');
  if (title.length > MAX_TITLE_LENGTH) {
    throw badRequest('invalid_title', `title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
  }
  return title;
}

/** @param {unknown} value */
function validateDescription(value) {
  const description = trimmedText(value);
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw badRequest(
      'invalid_description',
      `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
    );
  }
  return description;
}

/** @param {unknown} value */
function validatePrice(value) {
  if (!isValidPrice(value)) {
    throw badRequest(
      'invalid_price',
      `priceYen must be an integer between ${MIN_PRICE_YEN} and ${MAX_PRICE_YEN}.`,
    );
  }
  return value;
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
