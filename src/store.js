// In-memory data store. All state lives in this module's closure, so every
// createStore() call gives an isolated copy (tests rely on this).

const SEED_USERS = [
  { id: 'u1', name: 'Hana' },
  { id: 'u2', name: 'Ken' },
  { id: 'u3', name: 'Mio' },
];

const SEED_LISTINGS = [
  {
    id: 'l1',
    title: 'Film camera, 35mm',
    description: 'Works well. Light scratches on the body.',
    priceYen: 12800,
    sellerId: 'u1',
    status: 'on_sale',
    buyerId: null,
    createdAt: '2026-04-01T09:00:00.000Z',
  },
  {
    id: 'l2',
    title: 'Road bike helmet (M)',
    description: 'Used for one season.',
    priceYen: 4500,
    sellerId: 'u2',
    status: 'on_sale',
    buyerId: null,
    createdAt: '2026-04-02T09:00:00.000Z',
  },
  {
    id: 'l3',
    title: 'Mechanical keyboard',
    description: 'Brown switches, JIS layout.',
    priceYen: 7800,
    sellerId: 'u2',
    status: 'on_sale',
    buyerId: null,
    createdAt: '2026-04-03T09:00:00.000Z',
  },
  {
    id: 'l4',
    title: 'Camping stove',
    description: 'Compact gas stove with case.',
    priceYen: 3200,
    sellerId: 'u3',
    status: 'sold',
    buyerId: 'u1',
    createdAt: '2026-04-04T09:00:00.000Z',
  },
  {
    id: 'l5',
    title: 'Picture books, set of 10',
    description: 'For ages 3 to 6.',
    priceYen: 1500,
    sellerId: 'u3',
    status: 'on_sale',
    buyerId: null,
    createdAt: '2026-04-05T09:00:00.000Z',
  },
];

export function createStore({ users = SEED_USERS, listings = SEED_LISTINGS } = {}) {
  const userMap = new Map(users.map((u) => [u.id, { ...u }]));
  const listingMap = new Map(listings.map((l) => [l.id, { ...l }]));
  let nextListingNumber = listingMap.size + 1;

  return {
    getUser: (id) => userMap.get(id) ?? null,
    listUsers: () => [...userMap.values()],

    getListing: (id) => listingMap.get(id) ?? null,
    listListings: () => [...listingMap.values()],

    insertListing(fields) {
      const listing = { id: `l${nextListingNumber++}`, ...fields };
      listingMap.set(listing.id, listing);
      return listing;
    },

    updateListing(id, patch) {
      const current = listingMap.get(id);
      if (!current) return null;
      const next = { ...current, ...patch };
      listingMap.set(id, next);
      return next;
    },
  };
}
