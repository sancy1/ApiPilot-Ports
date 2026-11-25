# Unsafe methods

ApiPilot protects state-changing HTTP methods with CSRF validation.

## Protected set

Default `csrf.protected_methods`: `POST`, `PUT`, `PATCH`, `DELETE`.

- `GET`, `HEAD`, `OPTIONS`, `TRACE` are always safe — never validated.
- Custom sets via `csrf.protected_methods` (e.g. add `PURGE`).
- Method comparison is case-insensitive.

## Exemptions

- `csrf.bootstrap_path` (default `/api/csrf`) is exempt from validation
  on **every** method — the bootstrap endpoint must be reachable.
- Requests with `APIPILOT_SKIP_CSRF` in scope (set by upstream
  middleware) skip validation — use sparingly for internal endpoints.

## Interaction with other stages

Origin policy, fetch metadata, and cookie checks also run on unsafe
methods only. Safe methods skip the entire security pipeline after
content negotiation.
