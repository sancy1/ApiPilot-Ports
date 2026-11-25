# Consumer CDCT — business-logic contract suite

Consumer-Driven Contract Testing for ApiPilot-Ports: each port runs the
**same consumer application** (a realistic API surface) through its
adapter and asserts **identical observable wire behavior**. This is the
layer unit tests and doc-snippet checks cannot reach — it proves a
developer with zero library knowledge gets the same envelopes, headers,
status codes, and security flows on every port.

## The consumer app

Every port implements these routes identically:

| Route | Behavior |
| --- | --- |
| `GET /health` | `sendSuccess({ status: "ok" })` |
| `GET /items` | reads pagination context, returns `{ page, pageSize }` |
| `GET /fail` | `sendError(RESOURCE_NOT_FOUND)` |
| `GET /validate` | `sendValidationError({ page: ["bad"] })` |
| `POST /echo` | returns `{ echo: <body> }` — CSRF-protected |
| `GET /api/csrf` | CSRF bootstrap (auto-registered) |

Options under test: `csrf.enabled`, `origin.enabled` +
`allowedOrigins=["https://app.example.com"]`, `paginationEnabled`,
`fetchMetadata.profile="strict"`.

## Scenarios (asserted identically on every port)

| # | Request | Expected |
| --- | --- | --- |
| S1 | `GET /health` | 200; `x-request-id` response header present; `body.success===true`; `body.meta.requestId` === header value |
| S2 | `GET /items?page=2&pageSize=5` | 200; `data.page===2`, `data.pageSize===5` |
| S3 | `GET /items?page=abc` | 400; `error.code==="VALIDATION_ERROR"`; `error.fields.page` present |
| S4 | `GET /fail` | 404; `error.code==="RESOURCE_NOT_FOUND"` |
| S5 | `POST /echo` + `Origin: https://evil.example` | 403; `error.code==="CSRF_ORIGIN_REJECTED"` |
| S6 | `GET /api/csrf` → `POST /echo` (no token) | bootstrap returns `{token}`; POST → 403 `CSRF_*`; POST with cookie+`x-csrf-token` → 200. POSTs carry `Origin: https://app.example.com` (origin policy requires it on unsafe methods) |
| S7 | `POST /echo` + `Sec-Fetch-Site: cross-site` (valid Origin) | rejected — strict fetch-metadata fails closed |

## Runners

| Port | File |
| --- | --- |
| `@apipilot/node` (raw http) | `typescript/node/test/consumer.test.mjs` |
| `@apipilot/fastify` | `typescript/fastify/test/consumer.mjs` |
| `@apipilot/hono` | `typescript/hono/test/consumer.test.mjs` |
| `@apipilot/next` | `typescript/next/test/consumer.test.mjs` |
| `apipilot` (ASGI) | `python/tests/test_consumer.py` |
| `httpapi` (Go) | `go/httpapi/consumer_test.go` |

Any scenario that diverges between ports is a **contract bug** — fix the
port, not the test.
