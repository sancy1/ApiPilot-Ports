# Troubleshooting 403

Every 403 from ApiPilot carries a stable `error.code`. Match the code to
the fix.

## `CSRF_HEADER_MISSING`

The request used an unsafe method without the CSRF header.

- Ensure the client fetched `GET /api/csrf` and echoes the token in
  `X-CSRF-Token` (or your configured `HeaderName`).
- Check `Csrf.ProtectedMethods` — `GET`/`HEAD`/`OPTIONS`/`TRACE` are
  exempt by default.

## `CSRF_TOKEN_INVALID`

Signature, payload, or binding mismatch.

- Token must be fresh from the bootstrap endpoint — do not cache across
  binding changes (login/logout).
- Binding fingerprint must match: subject → session → preauth. If the
  user's identity changed between bootstrap and request, the token is
  invalid by design.
- Check clock skew — `issuedAt` is validated but skew tolerance is not
  configurable; keep servers NTP-synced.

## `CSRF_TOKEN_EXPIRED`

`issuedAt` older than `Csrf.TokenLifetimeSeconds` (default 3600).

- Re-fetch the bootstrap token; do not extend lifetime beyond your
  session policy.

## `CSRF_ORIGIN_REJECTED`

Origin, fetch-metadata, or cookie policy rejected the request.

- `Origin`/`Referer` must match `Origin.AllowedOrigins` exactly (or per
  `MatchMode`).
- `Sec-Fetch-Site` must be in `AllowedSiteValues` — `cross-site` is
  rejected under `strict`.
- Session cookies must satisfy the `CookieProfile` (`Secure`,
  `HttpOnly`, `SameSite`).

## Bootstrap returns 403

`CSRF_ORIGIN_REJECTED` on `GET /api/csrf` means origin/fetch-metadata/
cookie policy rejected the bootstrap itself — check those options before
the token flow.

## Still stuck

Enable `Options.Diagnostics`-style logging: the middleware logs the
rejection reason (`missingSiteHeader`, `disallowedSiteValue`, etc.) at
warn level when a logger is attached.
