# Unsafe methods

ApiPilot protects state-changing HTTP methods with CSRF validation.

## Protected set

Default `csrf.protectedMethods`: `POST`, `PUT`, `PATCH`, `DELETE`.

- `GET`, `HEAD`, `OPTIONS`, `TRACE` are always safe — never validated.
- Custom sets via `csrf.protectedMethods` (e.g. add `PURGE`).
- Method comparison is case-insensitive.

## Exemptions

- `csrf.bootstrapPath` (default `/api/csrf`) is exempt from validation
  on **every** method — the bootstrap endpoint must be reachable.
- Requests with `APIPILOT_SKIP_CSRF` on the request (set by upstream
  hooks) skip validation — use sparingly for internal endpoints.

## Interaction with other stages

Origin policy, fetch metadata, and cookie checks also run on unsafe
methods only. Safe methods skip the entire security pipeline after
content negotiation.
