// HTTP layer: routing, mock auth, JSON in/out, static files, request IDs,
// access logs and request metrics.
// Business rules live in listings.js and favorites.js; data lives in store.js.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { AppError, badRequest, notFound, unauthorized } from './errors.js';
import { createFavoriteService } from './favorites.js';
import { createFlags } from './flags.js';
import { createListingService } from './listings.js';
import { createLogger } from './logger.js';
import { createMetrics, METRICS_CONTENT_TYPE } from './metrics.js';
import { createStore } from './store.js';

/**
 * @typedef {import('node:http').IncomingMessage} Request
 * @typedef {import('node:http').ServerResponse} Response
 * @typedef {import('./store.js').Store} Store
 * @typedef {import('./logger.js').Logger} Logger
 * @typedef {import('./metrics.js').Metrics} Metrics
 * @typedef {import('./flags.js').Flags} Flags
 * @typedef {{ req: Request, params: Record<string, string>, query: URLSearchParams }} RouteContext
 * @typedef {{ status: number, body: unknown } | { status: number, text: string, contentType: string }} RouteResult
 * @typedef {(context: RouteContext) => RouteResult | Promise<RouteResult>} RouteHandler
 * @typedef {[method: string, pattern: string, handler: RouteHandler]} Route
 * @typedef {{ method: string, path: string }} RouteInfo
 * @typedef {((req: Request, res: Response) => Promise<void>) & { routes: RouteInfo[] }} App
 */

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const MAX_BODY_BYTES = 64 * 1024;
// A caller's X-Request-ID is reused only when it is a short plain token, because
// it is echoed into response headers and logs.
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * @param {{ store?: Store, now?: () => Date, logger?: Logger, metrics?: Metrics, flags?: Flags }} [options]
 * @returns {App}
 */
export function createApp({
  store = createStore(),
  now,
  logger = createLogger({ level: 'error' }),
  metrics = createMetrics(),
  flags = createFlags(),
} = {}) {
  const listings = createListingService(store, now ? { now } : undefined);
  const favorites = createFavoriteService(store, now ? { now } : undefined);

  // Mock auth: the caller names itself with the X-User-Id header.
  /** @param {Request} req */
  function requireUser(req) {
    const user = optionalUser(req);
    if (!user) throw unauthorized();
    return user;
  }

  // Public routes stay public: a missing or unknown user is just a guest viewer.
  /** @param {Request} req */
  function optionalUser(req) {
    return store.getUser(headerValue(req, 'x-user-id'));
  }

  // Each route: [method, pattern, handler]. `:name` segments become params.
  /** @type {Route[]} */
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
      'PATCH',
      '/api/listings/:id',
      async ({ req, params }) => {
        const user = requireUser(req);
        const input = await readJson(req);
        return {
          status: 200,
          body: { listing: favorites.decorate(listings.edit(user, params.id, input), user) },
        };
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
      'POST',
      '/api/listings/:id/withdraw',
      ({ req, params }) => {
        const user = requireUser(req);
        return {
          status: 200,
          body: { listing: favorites.decorate(listings.withdraw(user, params.id), user) },
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
  if (flags.isEnabled('metrics_endpoint')) {
    routes.push([
      'GET',
      '/api/metrics',
      () => ({ status: 200, text: metrics.render(), contentType: METRICS_CONTENT_TYPE }),
    ]);
  }

  /**
   * Answers one request. `trace.route` is set to the matched route pattern so
   * logs and metrics can group requests without using the raw path.
   * @param {Request} req
   * @param {Response} res
   * @param {URL} url
   * @param {{ route: string }} trace
   */
  async function respond(req, res, url, trace) {
    if (!url.pathname.startsWith('/api/')) return sendStatic(res, url.pathname);
    const match = findRoute(routes, req.method ?? '', url.pathname);
    if (!match) throw notFound('route_not_found', `No route for ${req.method} ${url.pathname}.`);
    trace.route = match.pattern;
    const result = await match.handler({ req, params: match.params, query: url.searchParams });
    if ('text' in result) return sendText(res, result.status, result.text, result.contentType);
    return sendJson(res, result.status, result.body);
  }

  /**
   * @param {Response} res
   * @param {unknown} err
   * @param {{ req: Request, url: URL, requestId: string }} context
   */
  function sendError(res, err, { req, url, requestId }) {
    if (err instanceof AppError) {
      return sendJson(res, err.status, { error: { code: err.code, message: err.message } });
    }
    logger.error('unhandled_error', {
      requestId,
      method: req.method,
      path: url.pathname,
      headers: req.headers,
      error: err,
    });
    return sendJson(res, 500, { error: { code: 'internal', message: 'Unexpected error.' } });
  }

  /** @type {App} */
  const handle = async function handle(req, res) {
    const startedAt = performance.now();
    const requestId = requestIdFrom(headerValue(req, 'x-request-id'));
    res.setHeader('x-request-id', requestId);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const trace = { route: url.pathname.startsWith('/api/') ? 'unmatched' : 'static' };
    try {
      await respond(req, res, url, trace);
    } catch (err) {
      sendError(res, err, { req, url, requestId });
    }
    const durationMs = performance.now() - startedAt;
    metrics.observeRequest({ method: req.method, route: trace.route, status: res.statusCode, durationMs });
    logger.info('request', {
      requestId,
      method: req.method,
      path: url.pathname,
      route: trace.route,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    });
  };
  handle.routes = routes.map(([method, path]) => ({ method, path }));
  return handle;
}

/**
 * The header as one string; repeated headers that Node keeps as an array count as absent.
 * @param {Request} req
 * @param {string} name
 */
function headerValue(req, name) {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/** @param {string | undefined} incoming */
function requestIdFrom(incoming) {
  return incoming !== undefined && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
}

/**
 * @param {Route[]} routes
 * @param {string} method
 * @param {string} pathname
 */
function findRoute(routes, method, pathname) {
  const parts = pathname.split('/');
  for (const [routeMethod, pattern, handler] of routes) {
    if (routeMethod !== method) continue;
    const patternParts = pattern.split('/');
    if (patternParts.length !== parts.length) continue;
    /** @type {Record<string, string>} */
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
    if (ok) return { handler, params, pattern };
  }
  return null;
}

/**
 * @param {Request} req
 * @returns {Promise<unknown>}
 */
async function readJson(req) {
  /** @type {Buffer[]} */
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

/**
 * @param {Response} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  sendText(res, status, JSON.stringify(body), 'application/json; charset=utf-8');
}

/**
 * @param {Response} res
 * @param {number} status
 * @param {string} payload
 * @param {string} contentType
 */
function sendText(res, status, payload, contentType) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * @param {Response} res
 * @param {string} pathname
 */
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
