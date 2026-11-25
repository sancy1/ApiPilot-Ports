# Response contract

Every ApiPilot response uses one of three envelopes. The wire format is
identical across all ports and the C# library.

## Success envelope

```json
{
  "success": true,
  "data": { "pong": "yes" },
  "message": null,
  "meta": {
    "requestId": "01a20ef3-bb3a-7161-b1f2-9cd608a0c02f",
    "timestamp": "2026-11-24T19:06:23.937Z",
    "extra": {}
  }
}
```

- `data` is always present (may be `null`).
- `message` is `null` unless the handler supplies one.
- `meta.requestId` echoes the correlation ID.
- `meta.timestamp` is ISO 8601 UTC.
- `meta.extra` is an object for application metadata.

TypeScript: `sendSuccess(req, res, data, { status, message })`.

## Paginated envelope

A success envelope plus a `pagination` sibling of `data`:

```json
{
  "success": true,
  "data": [ ... ],
  "message": null,
  "meta": { ... },
  "pagination": {
    "page": 2,
    "pageSize": 20,
    "totalItems": 95,
    "totalPages": 5,
    "hasNext": true,
    "hasPrevious": true
  }
}
```

All six pagination fields are required when present. TypeScript:
`sendPaginated(req, res, data, pagination, { status, message })`.
Build the block with `buildPagination(totalItems, page, pageSize)`.

## Error envelope

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource was not found.",
    "fields": { "name": ["required"] }
  },
  "meta": { "requestId": "...", "timestamp": "...", "extra": {} }
}
```

- `error.fields` is present **only** for `VALIDATION_ERROR`.
- `meta` is present on middleware-generated errors; handler-sent errors
  may omit it.

TypeScript: `sendError(req, res, code, message, { status, fields, headers })`
— `code` accepts an `ApiErrorCode` or a custom string (custom codes fall
through to HTTP 500 unless `status` is supplied).

## Rules

- Envelope keys are pinned: `success`, `data`, `message`, `meta`,
  `pagination`, `error`, `code`, `fields`, `requestId`, `timestamp`,
  `extra`. Naming policy never renames them.
- `success` is a JSON boolean, never a string.
- Error `code` values are the stable strings in `error-contract.md`.
