# Troubleshooting 403

Every 403 from ApiPilot carries a stable `error.code`. Match the code to
the fix.

## `CSRF_HEADER_MISSING`

The request used an unsafe method without the CSRF header.

- Ensure the client fetched `GET /api/csrf` and echoes the token in
  `X-CSRF-Token` (or your configured `headerName`).
- Check `csrf.protectedMethods` — `GET`/`HEAD`/`OPTIONS`/`TRACE` are
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

`issuedAt` older than `csrf.tokenLifetimeSeconds` (default 7200).

- Re-fetch the bootstrap token; do not extend lifetime beyond your
  session policy.

## `CSRF_ORIGIN_REJECTED`

Origin, fetch-metadata, or cookie policy rejected the request.

- `Origin`/`Referer` must match `origin.allowedOrigins` exactly (or per
  `matchMode`).
- `Sec-Fetch-Site` must be in `allowedSiteValues` — `cross-site` is
  rejected under `strict`.
- Session cookies must satisfy the `CookieProfile` (`Secure`,
  `HttpOnly`, `SameSite`).

## Bootstrap returns 403

`CSRF_ORIGIN_REJECTED` on `GET /api/csrf` means origin/fetch-metadata/
cookie policy rejected the bootstrap itself — check those options before
the token flow.

## Still stuck

Check the server logs and metrics — security rejections record their
reason (`missingSiteHeader`, `disallowedSiteValue`, etc.) via the
`Metrics` counters (`origin_rejected`, `fetch_metadata_rejected`,
`cookie_rejected`, `csrf.rejected`).
