// HTTP layer: routing, mock auth, JSON in/out, static files.
// Business rules live in listings.js and favorites.js; data lives in store.js.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AppError, badRequest, notFound, unauthorized } from './errors.js';
import { createFavoriteService } from './favorites.js';
import { createListingService } from './listings.js';
import { redact } from './redact.js';
import { createStore } from './store.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const MAX_BODY_BYTES = 64 * 1024;

export function createApp({ store = createStore(), now } = {}) {
  const listings = createListingService(store, now ? { now } : undefined);
  const favorites = createFavoriteService(store, now ? { now } : undefined);

  // Mock auth: the caller names itself with the X-User-Id header.
  function requireUser(req) {
    const user = optionalUser(req);
    if (!user) throw unauthorized();
    return user;
  }

  // Public routes stay public: a missing or unknown user is just a guest viewer.
  function optionalUser(req) {
    return store.getUser(req.headers['x-user-id']);
  }

  // Each route: [method, pattern, handler]. `:name` segments become params.
  const routes = [
    ['GET', '/api/health', () => ({ status: 200, body: { ok: true } })],
    ['GET', '/api/users', () => ({ status: 200, body: { users: store.listUsers() } })],
    ['GET', '/api/me', ({ req }) => ({ status: 200, body: { user: requireUser(req) } })],
    [
      'GET',
      '/api/me/favorites',
      ({ req }) => ({ status: 200, body: { listings: favorites.listSaved(requireUser(req)) } }),
    ],
    [
      'GET',
      '/api/listings',
      ({ req, query }) => ({
        status: 200,
        body: {
          listings: favorites.decorateAll(
            listings.list({
              status: query.get('status') ?? undefined,
              q: query.get('q') ?? undefined,
            }),
            optionalUser(req),
          ),
        },
      }),
    ],
    [
      'GET',
      '/api/listings/:id',
      ({ req, params }) => ({
        status: 200,
        body: { listing: favorites.decorate(listings.get(params.id), optionalUser(req)) },
      }),
    ],
    [
      'POST',
      '/api/listings',
      async ({ req }) => {
        const user = requireUser(req);
        const input = await readJson(req);
        return { status: 201, body: { listing: favorites.decorate(listings.create(user, input), user) } };
      },
    ],
    [
      'POST',
      '/api/listings/:id/purchase',
      ({ req, params }) => {
        const user = requireUser(req);
        return {
          status: 200,
          body: { listing: favorites.decorate(listings.purchase(user, params.id), user) },
        };
      },
    ],
    [
      'PUT',
      '/api/listings/:id/favorite',
      ({ req, params }) => ({
        status: 200,
        body: { listing: favorites.save(requireUser(req), params.id) },
      }),
    ],
    [
      'DELETE',
      '/api/listings/:id/favorite',
      ({ req, params }) => ({
        status: 200,
        body: { listing: favorites.remove(requireUser(req), params.id) },
      }),
    ],
  ];

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const match = findRoute(routes, req.method, url.pathname);
        if (!match) throw notFound('route_not_found', `No route for ${req.method} ${url.pathname}.`);
        const result = await match.handler({ req, params: match.params, query: url.searchParams });
        return sendJson(res, result.status, result.body);
      }
      return await sendStatic(res, url.pathname);
    } catch (err) {
      if (err instanceof AppError) {
        return sendJson(res, err.status, { error: { code: err.code, message: err.message } });
      }
      console.error(
        'unhandled_error',
        redact({ method: req.method, path: url.pathname, headers: req.headers, error: err }),
      );
      return sendJson(res, 500, { error: { code: 'internal', message: 'Unexpected error.' } });
    }
  };
}

function findRoute(routes, method, pathname) {
  const parts = pathname.split('/');
  for (const [routeMethod, pattern, handler] of routes) {
    if (routeMethod !== method) continue;
    const patternParts = pattern.split('/');
    if (patternParts.length !== parts.length) continue;
    const params = {};
    const ok = patternParts.every((p, i) => {
      if (p.startsWith(':')) {
        try {
          params[p.slice(1)] = decodeURIComponent(parts[i]);
        } catch {
          return false; // malformed percent-encoding
        }
        return parts[i].length > 0;
      }
      return p === parts[i];
    });
    if (ok) return { handler, params };
  }
  return null;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw badRequest('body_too_large', 'Request body is too large.');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badRequest('invalid_json', 'Request body must be valid JSON.');
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function sendStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = normalize(join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR) || filePath.endsWith(sep)) {
    throw notFound('not_found', 'Not found.');
  }
  let data;
  try {
    data = await readFile(filePath);
  } catch {
    throw notFound('not_found', 'Not found.');
  }
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
    'content-length': data.length,
  });
  res.end(data);
}
