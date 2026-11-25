# @apipilot/hono

Hono adapter for ApiPilot — the full request pipeline as Hono middleware
over the web `Request`/`Response` model. Works with Hono on Node
(`@hono/node-server`), Bun, Deno, and Cloudflare Workers.

## Install

```bash
npm install @apipilot/hono @apipilot/core @apipilot/node hono
```

## Quick start

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  apiPilotHono,
  apiPilotHonoErrorHandler,
  sendSuccess,
} from "@apipilot/hono";
import { generateKeyMaterial } from "@apipilot/node";

const app = new Hono();

app.use(apiPilotHono({
  csrfKeyRing: {
    activeKeyId: "k1",
    keys: { k1: Buffer.from(generateKeyMaterial(), "base64") },
  },
  csrf: { enabled: true },
  csrfBinding: {
    sessionExtractor: (c) => c.req.header("x-session-id") ?? null,
  },
  paginationEnabled: true,
}));

app.get("/health", (c) => sendSuccess(c, { status: "ok" }));

// Hono routes handler errors to onError — register the envelope mapper.
app.onError(apiPilotHonoErrorHandler());

serve(app);
```

Runnable example: `examples/hono-server.mjs` (`node examples/hono-server.mjs`).

## Pipeline

Same order as every other port: correlation → rate-limit →
content-negotiation → origin → fetch-metadata → CSRF bootstrap/validation →
pagination → downstream.

## Helpers

| Export | Purpose |
| --- | --- |
| `apiPilotHono(options)` | Pipeline middleware |
| `apiPilotHonoErrorHandler(options?)` | `app.onError` envelope mapper |
| `sendSuccess(c, data, opts?)` | Success envelope |
| `sendPaginated(c, data, pagination, opts?)` | Paginated envelope |
| `sendError(c, code, message, opts?)` | Error envelope |
| `sendValidationError(c, fields, message?)` | VALIDATION_ERROR envelope |
| `paginatedResponse(c, data, total, page, pageSize)` | Paginated envelope shorthand |
| `getPagination(c)` | Parsed pagination context |
| `getRequestId(c)` | Correlation id |
| `getMetrics(c)` | Pipeline metrics |
| `HonoCsrfBindingResolver` | subject → session → preauth binding |

## Notes

- **Error handling**: Hono's `compose` routes handler errors to
  `app.onError` at the dispatch level — middleware `try/catch` cannot
  intercept them. Always register `apiPilotHonoErrorHandler()`.
- **CSRF binding**: extractors receive the Hono `Context` (not
  `IncomingMessage`) — use `c.req.header(...)`.
- **Client IP**: `x-forwarded-for` first, then `c.env.incoming.socket`
  on `@hono/node-server`.
