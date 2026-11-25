# @apipilot/node

Generic Node.js adapter for ApiPilot — Connect/Express-style middleware over `node:http`.

Works with **Express, NestJS (Express), polka, Koa, and raw Node `http`** — anything that speaks `(req, res, next)`. Koa uses `apiPilotKoa()`/`apiPilotKoaErrorHandler()` (see below). (Hono uses a different `(c, next)` middleware signature — use `@apipilot/hono` instead.)

## Install

```bash
npm install @apipilot/node @apipilot/core
```

## Quick start

### Express

```ts
import express from "express";
import { apiPilot } from "@apipilot/node";

const app = express();
app.use(apiPilot({ csrf: { enabled: true } }));
app.post("/api/items", (req, res) => res.json({ ok: true }));
```

### Raw Node http

```ts
import { createServer } from "node:http";
import { withApiPilot } from "@apipilot/node";

createServer(withApiPilot((req, res) => {
  res.end(JSON.stringify({ ok: true }));
}, { csrf: { enabled: true } }));
```

### Koa

```ts
import Koa from "koa";
import { apiPilotKoa, apiPilotKoaErrorHandler, sendSuccess } from "@apipilot/node";

const app = new Koa();
app.use(apiPilotKoa({ csrf: { enabled: true } }));
app.use((ctx) => sendSuccess(ctx.req, ctx.res, { ok: true }));
app.use(apiPilotKoaErrorHandler()); // last — maps errors to envelopes
```

`ctx.req`/`ctx.res` are the raw Node req/res, so all response helpers
(`sendSuccess`, `sendPaginated`, `getPagination`, …) work unchanged.
Runnable example: `examples/koa-server.mjs`.

## Pipeline

The middleware runs the full ApiPilot pipeline in C# order:

1. **Correlation ID** — resolve/generate, optional echo header
2. **Rate limiting** — fixed window per client key (optional)
3. **Content negotiation** — Accept / Content-Type enforcement
4. **Origin policy** — unsafe methods only, fail-closed
5. **Fetch metadata** — `Sec-Fetch-*` enforcement
6. **CSRF** — bootstrap endpoint (`GET /api/csrf`) + token validation
7. **Pagination** — query parsing/validation when `paginationEnabled: true`

## CSRF

```ts
apiPilot({
  csrf: { enabled: true },
  csrfKeyRing,                    // or set APIPILOT_CSRF_KEYS / APIPILOT_CSRF_ACTIVE_KEY
  csrfBinding: {
    sessionExtractor: (req) => /* session id or null */,
    subjectExtractor: (req) => /* JWT sub or null */,
  },
  csrf: { rotationStore: new InMemoryRotationStore() },
})
```

See `docs/csrf.md` in `@apipilot/fastify` for the full CSRF contract (shared semantics).

## OpenAPI

Pass `openApi` to serve the ApiPilot OpenAPI document (error + pagination
schemas) at `documentPath` (default `/openapi/v1.json`):

```ts
apiPilot({ openApi: { documentTitle: "My API", documentVersion: "1.2.0" } })
```

Schema builders (`buildOpenApiDocument`, `errorSchemas`, `paginationSchema`)
are also exported for assembling your own document.

## Error handling

Register `apiPilotErrorHandler()` **last** in the chain — it maps thrown
exceptions to ApiPilot error envelopes (mirrors `ApiPilotExceptionMiddleware`):

```ts
import { apiPilot, apiPilotErrorHandler } from "@apipilot/node";

app.use(apiPilot({ ... }));
app.use(routes);
app.use(apiPilotErrorHandler({
  exceptions: { revealExceptionMessage: false },
  customMappers: [(err) => /* → { code, message } | null */],
  logger: console,
}));
```

- `ApiPilotValidationException` → `VALIDATION_ERROR` with field errors
- Errors with `statusCode` 404/409 → `RESOURCE_NOT_FOUND` / `CONFLICT`
- Everything else → `INTERNAL_ERROR` 500 (safe message unless `revealExceptionMessage`)

## Observability

```ts
import { Metrics, metricsFor } from "@apipilot/node";

const metrics = new Metrics();
apiPilot({ metrics });
// metrics.snapshot() → { "csrf.issued": n, "rate_limited": n, ... }
```

Redaction helpers: `redactString`, `redactValue`, `DEFAULT_REDACTION_POLICY`.

## Examples

```bash
npm run build
node examples/basic.mjs
```

## Tests

```bash
npm test          # unit + adapter conformance (30 tests)
npm run conformance  # 251 core vectors + 15 adapter wire-contract tests
```

The adapter conformance suite (`test/conformance-adapter.mjs`) exercises the
middleware over real HTTP and asserts the wire contracts defined by
`conformance/vectors/*.json` — envelope shapes, error-code/status mapping,
correlation ID behavior, pagination validation, CSRF bootstrap/validation,
and metrics counters.
