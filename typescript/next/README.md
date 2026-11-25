# @apipilot/next

Next.js adapter for ApiPilot — covers **both routers**:

- **App Router** (`app/api/*/route.ts`) — `withApiPilot` wraps route
  handlers over the web `Request`/`Response` model.
- **Pages Router** (`pages/api/*.ts`) — `withApiPilotPages` re-exports the
  node adapter wrapper (`NextApiRequest`/`NextApiResponse` extend Node's
  `IncomingMessage`/`ServerResponse`).

## Install

```bash
npm install @apipilot/next @apipilot/core @apipilot/node
```

## App Router

```ts
// app/api/items/route.ts
import { withApiPilot, apiSuccess, getPagination } from "@apipilot/next";
import { generateKeyMaterial } from "@apipilot/node";

const keyRing = {
  activeKeyId: "k1",
  keys: { k1: Buffer.from(generateKeyMaterial(), "base64") },
};

export const GET = withApiPilot(async (req) => {
  const p = getPagination(req); // parsed ?page=&pageSize= when enabled
  return apiSuccess({ items: [], page: p?.pageRequest.page ?? 1 }, req);
}, {
  csrfKeyRing: keyRing,
  csrf: { enabled: true },
  csrfBinding: {
    sessionExtractor: (req) => req.headers.get("x-session-id"),
  },
  paginationEnabled: true,
});

export const POST = withApiPilot(async (req) => {
  const body = await req.json();
  return apiSuccess({ created: body }, req, { status: 201 });
}, { /* same options — or share a configured wrapper */ });
```

Response helpers return web `Response` objects:

| Helper | Purpose |
| --- | --- |
| `apiSuccess(data, req, opts?)` | Success envelope |
| `apiPaginated(data, pagination, req, opts?)` | Paginated envelope |
| `apiPaginatedResponse(data, total, page, pageSize, req)` | Shorthand |
| `apiError(code, message, req, opts?)` | Error envelope |
| `apiValidationError(fields, req, message?)` | VALIDATION_ERROR envelope |

Context helpers: `getRequestId(req)`, `getPagination(req)`, `getMetrics(req)`.

**Exception mapping is built in** — `withApiPilot` catches handler throws
and maps them to envelopes (404→`RESOURCE_NOT_FOUND`, 409→`CONFLICT`,
other 4xx→`VALIDATION_ERROR`, else `INTERNAL_ERROR`). Custom mappers via
`customMappers` option.

## Pages Router

```ts
// pages/api/items.ts
import { withApiPilotPages } from "@apipilot/next";
import { sendSuccess } from "@apipilot/node";

export default withApiPilotPages(async (req, res) => {
  sendSuccess(req, res, { items: [] });
}, { csrf: { enabled: true } });
```

## Pipeline

Same order as every port: correlation → rate-limit → content-negotiation
→ origin → fetch-metadata → CSRF bootstrap/validation → pagination →
handler (with exception mapping).

## Notes

- **Runtime**: use `export const runtime = "nodejs"` (default) — the CSRF
  protector uses Node crypto. Edge runtime is not supported.
- **CSRF bootstrap**: `GET /api/csrf` returns `{ success, data: { token } }`
  with `Cache-Control: no-store`.
- **Correlation header** is merged into handler responses automatically.
