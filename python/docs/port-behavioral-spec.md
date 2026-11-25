# Port behavioral spec

This document distills the rules every ApiPilot port must replicate.
The Python port implements all of them; the conformance suite proves it.

## Envelopes

- Success: `{ success, data, message, meta }` — `data` always present.
- Paginated: success + `pagination` sibling with six fields.
- Error: `{ success: false, error: { code, message, fields? }, meta }`.
- `fields` only on `VALIDATION_ERROR`.

## Error codes

`VALIDATION_ERROR` (400), `AUTHENTICATION_REQUIRED` (401), `FORBIDDEN`
(403), `CSRF_HEADER_MISSING`/`CSRF_TOKEN_INVALID`/`CSRF_TOKEN_EXPIRED`/
`CSRF_ORIGIN_REJECTED` (403), `RESOURCE_NOT_FOUND` (404), `CONFLICT`
(409), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500), `NOT_ACCEPTABLE`
(406), `UNSUPPORTED_MEDIA_TYPE` (415).

## Correlation

- Header `X-Request-Id` (configurable), GUIDv7 generation.
- Invalid → `replace` (default) / `reject` / `useAsIs`.

## Content negotiation

- `Accept` → 406; `Content-Type` on body methods → 415.
- JSON only; `*/*` and missing Accept allowed by default.

## Origin / fetch metadata / cookies

- Origin allowlist (exact/anyPortSameHost/sameSite).
- Fetch metadata strict/compat/off profiles.
- Cookie profiles strict/lax/none on session cookie names.

## CSRF

- Bootstrap `GET /api/csrf` → `{ data: { token } }`, `no-store`.
- Token: `base64url(payload).base64url(hmac)`; payload
  `issuedAt|random|bindingFingerprint`.
- Binding: subject → session → preauth; null → fail closed.
- Unsafe methods only; bootstrap path exempt.

## Pagination

- `page`, `pageSize`, `sort`, `direction` + filter params.
- `max_page_size` cap; `page_number_base` for 0-based APIs.
- Validation errors → `VALIDATION_ERROR` with `error.fields`.

## Rate limiting

- Fixed window per key; `RATE_LIMITED` 429 + `Retry-After`.
- Key: remote IP or `key_extractor`.

## Serialization

- JSON envelopes; camelCase; ISO 8601 UTC timestamps.
- Field key normalization: `$.User.Name` → `user.name`.

## Diagnostics

- `csrf-no-binding`, `origin-empty-allowlist`, `rate-limit-defaults`.
