<!-- Generated from openapi.json by scripts/gen-api-docs.js. Do not edit; run npm run docs:api. -->

# sakura-market-mini API

HTTP API of the sakura-market-mini demo marketplace. Every response is JSON except `GET /api/metrics`, and errors look like `{ "error": { "code": "...", "message": "..." } }`. Every response carries an `X-Request-ID` header; send your own to correlate logs. Auth is a mock: send `X-User-Id: u1` (Hana), `u2` (Ken) or `u3` (Mio). Data lives in memory and resets when the server restarts.

The machine-readable schema is [openapi.json](openapi.json); test/openapi.test.js checks the running app against it.

## Routes

| Method | Path | Auth | Summary |
| --- | --- | --- | --- |
| GET | `/api/health` | no | Liveness check |
| GET | `/api/metrics` | no | Request and process metrics in the Prometheus text format |
| GET | `/api/users` | no | Seed users |
| GET | `/api/me` | yes | The calling user |
| GET | `/api/me/favorites` | yes | The caller's saved listings, most recently saved first |
| GET | `/api/listings` | no | List listings, newest first |
| POST | `/api/listings` | yes | Create a listing for the caller |
| GET | `/api/listings/{id}` | no | One listing |
| PATCH | `/api/listings/{id}` | yes | Change the title, description or price of the caller's listing |
| POST | `/api/listings/{id}/purchase` | yes | Buy a listing |
| PUT | `/api/listings/{id}/favorite` | yes | Save a listing for the caller |
| DELETE | `/api/listings/{id}/favorite` | yes | Remove a listing from the caller's saved items |

## Operations

### GET `/api/health`

Liveness check.

Auth: none.

| Status | Meaning | Error codes |
| --- | --- | --- |
| 200 | The server is up. |  |
| 500 | Unexpected server error. The details are in the server log under the same request ID. | `internal` |

### GET `/api/metrics`

Request and process metrics in the Prometheus text format.

Request counts and durations by method, route pattern and status, plus uptime and memory. Turned off with `FEATURE_FLAGS=metrics_endpoint=off`, in which case the route answers `404 route_not_found`.

Auth: none.

| Status | Meaning | Error codes |
| --- | --- | --- |
| 200 | Prometheus text exposition format 0.0.4. |  |
| 500 | Unexpected server error. The details are in the server log under the same request ID. | `internal` |

### GET `/api/users`

Seed users.

Auth: none.

| Status | Meaning | Error codes |
| --- | --- | --- |
| 200 | All users. |  |
| 500 | Unexpected server error. The details are in the server log under the same request ID. | `internal` |

### GET `/api/me`

The calling user.

Auth: `X-User-Id` required.

| Status | Meaning | Error codes |
| --- | --- | --- |
| 200 | The user named by `X-User-Id`. |  |
| 401 | No `X-User-Id` header, or it names no known user. | `unauthorized` |
| 500 | Unexpected server error. The details are in the server log under the same request ID. | `internal` |

### GET `/api/me/favorites`

The caller's saved listings, most recently saved first.

Always the caller's whole list: query parameters are ignored. Listings sold after they were saved stay in the list with `status: "sold"`.

Auth: `X-User-Id` required.

| Status | Meaning | Error codes |
| --- | --- | --- |
| 200 | Saved listings. |  |
| 401 | No `X-User-Id` header, or it names no known user. | `unauthorized` |
| 500 | Unexpected server error. The details are in the server log under the same request ID. | `internal` |

### GET `/api/listings`

List listings, newest first.

Auth: none.

| Parameter | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `status` | query | "on_sale" \| "sold" | no | Only listings with this status. |
| `q` | query | string | no | Case-insensitive search in titles. |

| Status | Meaning | Error codes |
| --- | --- | --- |
| 200 | Matching listings. |  |
| 400 | `status` is not a known status. | `invalid_status` |
| 500 | Unexpected server error. The details are in the server log under the same request ID. | `internal` |

### POST `/api/listings`

Create a listing for the caller.

Auth: `X-User-Id` required.

Request body (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | yes | Trimmed; 1 to 80 characters. min length 1, max length 80 |
| `description` | string | no | Trimmed; up to 1000 characters. max length 1000 |
| `priceYen` | integer | yes | min 300, max 9999999 |

| Status | Meaning | Error codes |
| --- | --- | --- |
| 201 | The new listing, on sale. |  |
| 400 | The body is not valid JSON, is larger than 64 KiB, or breaks a field rule. | `invalid_json`, `body_too_large`, `invalid_title`, `invalid_description`, `invalid_price` |
| 401 | No `X-User-Id` header, or it names no known user. | `unauthorized` |
| 500 | Unexpected server error. The details are in the server log under the same request ID. | `internal` |

### GET `/api/listings/{id}`

One listing.

Auth: none.

| Parameter | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes | Listing ID, for example `l2`. |

| Status | Meaning | Error codes |
| --- | --- | --- |
| 200 | The listing. |  |
| 404 | The listing does not exist. | `listing_not_found` |
| 500 | Unexpected server error. The details are in the server log under the same request ID. | `internal` |

### PATCH `/api/listings/{id}`

Change the title, description or price of the caller's listing.

Only the seller can edit a listing, and only while it is on sale. Send any of `title`, `description` and `priceYen`: fields left out keep their values, and other fields such as `status` or `sellerId` are ignored. The new values follow the same rules as on create; if any of them is invalid, nothing changes. A successful edit sets `updatedAt`. The listing keeps its place in the list and its saves.

Auth: `X-User-Id` required.

| Parameter | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes | Listing ID, for example `l2`. |

Request body (JSON):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | no | Trimmed; 1 to 80 characters. min length 1, max length 80 |
| `description` | string | no | Trimmed; up to 1000 characters. max length 1000 |
| `priceYen` | integer | no | min 300, max 9999999 |

| Status | Meaning | Error codes |
| --- | --- | --- |
| 200 | The edited listing. |  |
| 400 | The body is not valid JSON, is larger than 64 KiB, has none of the editable fields, or breaks a field rule. | `invalid_json`, `body_too_large`, `no_changes`, `invalid_title`, `invalid_description`, `invalid_price` |
| 401 | No `X-User-Id` header, or it names no known user. | `unauthorized` |
| 403 | The caller is not the seller. | `not_seller` |
| 404 | The listing does not exist. | `listing_not_found` |
| 409 | The listing is sold or withdrawn. | `already_sold`, `listing_withdrawn` |
| 500 | Unexpected server error. The details are in the server log under the same request ID. | `internal` |

### POST `/api/listings/{id}/purchase`

Buy a listing.

Auth: `X-User-Id` required.

| Parameter | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes | Listing ID, for example `l2`. |

| Status | Meaning | Error codes |
| --- | --- | --- |
| 200 | The listing, now sold to the caller. |  |
| 401 | No `X-User-Id` header, or it names no known user. | `unauthorized` |
| 404 | The listing does not exist. | `listing_not_found` |
| 409 | The caller is the seller, or the listing is already sold. | `own_listing`, `already_sold` |
| 500 | Unexpected server error. The details are in the server log under the same request ID. | `internal` |

### PUT `/api/listings/{id}/favorite`

Save a listing for the caller.

Saving a listing that is already saved succeeds and changes nothing. Sold listings can be saved. A user can keep at most 100 saved listings.

Auth: `X-User-Id` required.

| Parameter | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes | Listing ID, for example `l2`. |

| Status | Meaning | Error codes |
| --- | --- | --- |
| 200 | The listing with its updated `savedCount` and `savedByMe: true`. |  |
| 401 | No `X-User-Id` header, or it names no known user. | `unauthorized` |
| 404 | The listing does not exist. | `listing_not_found` |
| 409 | The caller is the seller, or already has 100 saved listings. | `own_listing`, `favorites_limit_reached` |
| 500 | Unexpected server error. The details are in the server log under the same request ID. | `internal` |

### DELETE `/api/listings/{id}/favorite`

Remove a listing from the caller's saved items.

Removing a listing that is not saved succeeds and changes nothing.

Auth: `X-User-Id` required.

| Parameter | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes | Listing ID, for example `l2`. |

| Status | Meaning | Error codes |
| --- | --- | --- |
| 200 | The listing with its updated `savedCount` and `savedByMe: false`. |  |
| 401 | No `X-User-Id` header, or it names no known user. | `unauthorized` |
| 404 | The listing does not exist. | `listing_not_found` |
| 500 | Unexpected server error. The details are in the server log under the same request ID. | `internal` |

## Schemas

### User

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |
| `name` | string | yes |  |

### ListingStatus

"on_sale" \| "sold" \| "withdrawn"

### Listing

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |
| `title` | string | yes |  |
| `description` | string | yes |  |
| `priceYen` | integer | yes | min 0 |
| `sellerId` | string | yes |  |
| `status` | ListingStatus | yes |  |
| `buyerId` | string \| null | yes |  |
| `createdAt` | string | yes | date-time |
| `updatedAt` | string \| null | yes | When the seller last edited the listing; null until the first edit. date-time |
| `savedCount` | integer | yes | How many users saved the listing. Public. min 0 |
| `savedByMe` | boolean | yes | Whether the caller saved it; false for guests. |

### Error

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `error` | object | yes |  |
