# Architecture

sakura-market-mini is one Node.js process with no runtime dependencies. All
data lives in memory in `src/store.js` and resets on restart.

## Modules

```mermaid
flowchart LR
  browser["public/ (browser client)"] -->|fetch /api/*| app
  curl["curl, tests"] --> app
  server["src/server.js<br/>env, .env, LOG_LEVEL, FEATURE_FLAGS"] --> app
  app["src/app.js<br/>routing, auth, JSON, request IDs"] --> listings["src/listings.js"]
  app --> favorites["src/favorites.js"]
  listings --> store["src/store.js"]
  favorites --> store
  app --> logger["src/logger.js"] --> redact["src/redact.js"]
  app --> metrics["src/metrics.js"]
  app --> flags["src/flags.js"]
```

## One request

```mermaid
sequenceDiagram
  participant C as Client
  participant A as app.js handle()
  participant S as listings.js / favorites.js
  participant D as store.js
  C->>A: HTTP request (X-User-Id, optional X-Request-ID)
  A->>A: reuse or generate request ID, set X-Request-ID header
  A->>A: findRoute(method, path)
  alt API route
    A->>A: requireUser / optionalUser (mock auth)
    A->>S: plain values (user, params, body)
    S->>D: read / write
    S-->>A: result, or throws AppError
    A-->>C: JSON body, or { error: { code, message } }
  else not /api/
    A-->>C: static file from public/
  end
  A->>A: metrics.observeRequest(route pattern, status, duration)
  A->>A: logger.info('request', { requestId, route, status, durationMs })
```

- Errors thrown as `AppError` become their status and code. Anything else
  becomes `500 internal`, and the redacted error is logged as
  `unhandled_error` with the request ID.
- Routes and their responses are described in [api/openapi.json](api/openapi.json)
  and rendered to [api/README.md](api/README.md).
- The browser client keeps page state in `public/controller.js` and only talks
  to the API.
