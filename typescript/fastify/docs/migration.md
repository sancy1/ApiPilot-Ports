# Migration

## From another CSRF library

1. Replace token issuance with `GET /api/csrf` bootstrap.
2. Replace token validation with the `X-CSRF-Token` header check —
   the plugin handles it.
3. Configure `DefaultCsrfBindingResolver` with your subject/session
   extractors.
4. Remove old CSRF hooks; keep ApiPilot's pipeline order.

## From a custom envelope

Map your response shape to the ApiPilot envelopes:

- Success → `sendSuccess` / `sendPaginated`.
- Error → `sendError` / `sendErrorByCode` / `sendValidationError`.
- Keep `meta.requestId` for correlation.

## From Express middleware

`@apipilot/fastify` is a Fastify plugin — register it:

```ts
await app.register(apipilot, options);
```

For Express, use the Go or Python port's middleware pattern, or wrap
the Fastify plugin's hooks manually.

## From NestJS

NestJS runs on Express/Fastify — register the plugin on the underlying
Fastify instance, or use the Go/Python ports for non-Node backends.
