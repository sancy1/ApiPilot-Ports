# Migration

## From another CSRF library

1. Replace token issuance with `GET /api/csrf` bootstrap.
2. Replace token validation with the `X-CSRF-Token` header check —
   the middleware handles it.
3. Configure `csrfBinding` extractors (`subjectExtractor`,
   `sessionExtractor`, `preAuthSource`) for your session model.
4. Remove old CSRF hooks; keep ApiPilot's pipeline order.

## From a custom envelope

Map your response shape to the ApiPilot envelopes:

- Success → `sendSuccess` / `sendPaginated`.
- Error → `sendError` / `sendValidationError` (custom codes pass as
  strings to `sendError`).
- Keep `meta.requestId` for correlation.

## From Express middleware

`@apipilot/node` is a Connect/Express-style middleware — register it
directly:

```ts
import express from "express";
import { apiPilot, apiPilotErrorHandler } from "@apipilot/node";

const app = express();
app.use(apiPilot(options));
app.use(routes);
app.use(apiPilotErrorHandler()); // last — maps errors to envelopes
```

It also works with NestJS (Express platform), polka, and raw
`node:http` servers. (Hono's `(c, next)` middleware signature differs —
it is not directly compatible.)

## From NestJS

NestJS runs on Express by default — register `apiPilot()` as global
middleware (`app.use(...)`) before routes, and `apiPilotErrorHandler()`
after. On the Fastify platform, use `@apipilot/fastify` instead.
