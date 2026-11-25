# Error contract

## Standard codes

| Code | HTTP status | Notes |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Only code carrying `fields` |
| `AUTHENTICATION_REQUIRED` | 401 | |
| `FORBIDDEN` | 403 | |
| `CSRF_HEADER_MISSING` | 403 | |
| `CSRF_TOKEN_INVALID` | 403 | Bad signature/payload/binding |
| `CSRF_TOKEN_EXPIRED` | 403 | |
| `CSRF_ORIGIN_REJECTED` | 403 | Origin/fetch-metadata rejection |
| `RESOURCE_NOT_FOUND` | 404 | |
| `CONFLICT` | 409 | |
| `RATE_LIMITED` | 429 | |
| `INTERNAL_ERROR` | 500 | Safe message by default |
| `CONFIGURATION_ERROR` | 500 | Startup-only; never on the wire |
| `NOT_ACCEPTABLE` | 406 | Accept negotiation failure |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Content-Type negotiation failure |

Custom codes are permitted via `core.ApiErrorCodeFrom` / `SendErrorByCode`;
they fall through to HTTP 500 unless the caller supplies a status.

## Validation errors

`VALIDATION_ERROR` is the only code that carries `error.fields`:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more values are invalid.",
    "fields": {
      "user.name": ["required"],
      "items[0].qty": ["must be positive"]
    }
  },
  "meta": { "requestId": "..." }
}
```

- The default message is `"One or more values are invalid."` — applied
  when the message is empty or whitespace (mirrors C#
  `ValidationResponseFactory.DefaultMessage`).
- Field keys are normalized: JSONPath `$.User.Name` → `user.name`;
  bracket segments preserved (`items[0].qty`). See `validation.md`.

Go: `httpapi.SendValidationError(w, requestID, fields, message)`.

## Exception mapping

Unhandled panics/errors are mapped by `Middleware.handleException`:

1. Custom `ExceptionMappers` run first (first non-nil wins).
2. Errors exposing `StatusCode() int` in 400–499 map to
   `RESOURCE_NOT_FOUND` (404), `CONFLICT` (409), or `VALIDATION_ERROR`.
3. Everything else → `INTERNAL_ERROR` 500 with the safe message
   `"An unexpected error occurred."` unless
   `Exceptions.RevealExceptionMessage` is set.

## Retry-After

Rate-limit rejections may carry a `Retry-After` header (whole seconds
until the window resets). The value is computed from the limiter window —
never invented.
