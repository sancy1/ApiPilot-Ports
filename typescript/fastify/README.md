<!--
filepath: typescript/fastify/README.md
package:  @apipilot/fastify
since:    v0.1.0
purpose:  ApiPilot adapter for Fastify — middleware, CSRF protection, envelopes, pagination, content negotiation, origin and fetch-metadata policies.
-->

# @apipilot/fastify

The Fastify adapter for [ApiPilot](https://github.com/sancy1/ApiPilot).
Registers the full ApiPilot middleware pipeline on a Fastify instance:
correlation IDs, error envelopes, content negotiation, origin policy,
fetch-metadata policy, and CSRF protection.

Built on [`@apipilot/core`](../core) — all wire-contract logic lives in
the framework-neutral core; this package is the HTTP binding.

## Install

```bash
npm install @apipilot/fastify @apipilot/core fastify
```

## Quick start

```ts
import Fastify from "fastify";
import { apipilotPlugin, sendSuccess } from "@apipilot/fastify";

const app = Fastify();

await app.register(apipilotPlugin, {
  csrf: { enabled: true },
  origin: { enabled: true, allowedOrigins: ["https://app.example.com"] },
});

app.get("/ping", async (req, reply) => sendSuccess(req, reply, { pong: true }));
```

Every response uses the ApiPilot envelope:

```json
{ "success": true, "data": { "pong": true }, "message": null,
  "meta": { "requestId": "…", "timestamp": "…", "extra": {} } }
```

## CSRF protection

When `csrf.enabled` is true the plugin:

- registers `GET /api/csrf` (configurable) returning `{ "token": "…" }`
  with `Cache-Control: no-store`
- rejects unsafe methods (POST/PUT/PATCH/DELETE) missing the
  `X-CSRF-TOKEN` header with `CSRF_HEADER_MISSING` (403)
- validates the token's signature, expiry, and binding fingerprint,
  returning `CSRF_TOKEN_INVALID` / `CSRF_TOKEN_EXPIRED` on failure

The cryptographic boundary is AES-256-GCM with a shared key ring —
the Data-Protection equivalent. Configure via environment:

```bash
APIPILOT_CSRF_KEYS="k1:<base64-32-byte-key>"
APIPILOT_CSRF_ACTIVE_KEY="k1"
```

or pass `csrfKeyRing` directly to the plugin. Binding resolution order:
subject extractor → session extractor → pre-auth source (all configurable
via `csrfBinding`).

## Middleware order

Mirrors the C# pipeline:

1. **Correlation** — `X-Request-Id` in/out, GUIDv7 generation, invalid-ID policy
2. **Error handler** — wraps everything; maps exceptions to error envelopes
3. **Content negotiation** — 406/415 on Accept/Content-Type
4. **Origin policy** — RFC 6454 matching on unsafe methods
5. **Fetch metadata** — Sec-Fetch-Site/Mode evaluation
6. **CSRF** — token validation on protected methods

## Helpers

| Export | Purpose |
|---|---|
| `sendSuccess` / `sendPaginated` / `sendError` / `sendValidationError` / `sendRateLimited` | Envelope reply helpers |
| `paginationHook` + `getPagination` | Query parsing → `PageRequest`/`Sort`/`Filter` on the request |
| `CsrfProtector` / `keyRingFromEnv` / `generateKeyMaterial` | CSRF crypto boundary |
| `CsrfService` / `DefaultCsrfBindingResolver` | Token issue/validate + binding |
| `ApiPilotValidationException` | Throw to emit `VALIDATION_ERROR` with `fields` |
| `exceptionMappers` plugin option | Custom exception → code mappings |

## Conformance

`@apipilot/core` passes all 107 ApiPilot conformance vectors
(251 assertions). The adapter is verified by integration tests
covering envelopes, correlation, negotiation, origin, and the full
CSRF round-trip.

## License

Apache-2.0 — same as ApiPilot.
