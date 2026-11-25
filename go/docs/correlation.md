# Correlation

Every ApiPilot response carries a correlation ID in `meta.requestId` and
(optionally) in a response header. The ID is resolved per request by
`core.ResolveCorrelationID`.

## Resolution order

1. **Absent header** → generate a GUIDv7 (`core.GenerateGuidV7`).
2. **Present + matches `ValidationPattern`** → use incoming.
3. **Present + no match** → apply `InvalidIdPolicy`:
   - `replace` (default) → generate a new GUIDv7.
   - `reject` → 400 `VALIDATION_ERROR`.
   - `useAsIs` → use incoming and log a warning.

## Options (`core.CorrelationOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `HeaderName` | `X-Request-Id` | Incoming header to read. |
| `ValidationPattern` | `^[A-Za-z0-9][A-Za-z0-9\-_]{0,127}$` | nil disables validation. |
| `InvalidIdPolicy` | `replace` | `replace` \| `reject` \| `useAsIs`. |
| `EchoInResponseHeader` | true | Emit the ID as a response header. |
| `EchoInResponseBody` | true | Include in `meta.requestId`. |

## GUIDv7

`core.GenerateGuidV7` produces RFC 9562 UUIDv7: 48-bit big-endian
unix-ms timestamp + version `7` + variant `10xx` + random. Time-ordered,
lexicographically sortable, 122 bits of randomness.

## Go usage

```go
opts := httpapi.DefaultOptions()
opts.Correlation.HeaderName = "X-Correlation-Id"
opts.Correlation.InvalidIdPolicy = core.InvalidIDReject
```

The resolved ID is available to handlers via `httpapi.RequestID(r)`.
