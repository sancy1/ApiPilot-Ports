# Correlation

Every ApiPilot response carries a correlation ID in `meta.requestId` and
(optionally) in a response header. The ID is resolved per request by
`resolveCorrelationId`.

## Resolution order

1. **Absent header** → generate a GUIDv7 (`generateGuidV7`).
2. **Present + matches `validationPattern`** → use incoming.
3. **Present + no match** → apply `invalidIdPolicy`:
   - `replace` (default) → generate a new GUIDv7.
   - `reject` → 400 `VALIDATION_ERROR`.
   - `useAsIs` → use incoming and log a warning.

## Options (`CorrelationOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `headerName` | `X-Request-Id` | Incoming header to read. |
| `validationPattern` | `^[A-Za-z0-9][A-Za-z0-9\-_]{0,127}$` | null disables validation. |
| `invalidIdPolicy` | `replace` | `replace` \| `reject` \| `useAsIs`. |
| `echoInResponseHeader` | true | Emit the ID as a response header. |
| `echoInResponseBody` | true | Include in `meta.requestId`. |

## GUIDv7

`generateGuidV7` produces RFC 9562 UUIDv7: 48-bit big-endian
unix-ms timestamp + version `7` + variant `10xx` + random. Time-ordered,
lexicographically sortable, 122 bits of randomness.

## TypeScript usage

```ts
app.use(apiPilot({
  correlation: {
    headerName: "X-Correlation-Id",
    invalidIdPolicy: "reject",
  },
}));
```

The resolved ID is stored on the request (symbol-keyed) and retrieved
with `getRequestId(req)` — it is also echoed in `meta.requestId` on
every envelope.
