# Correlation

Every ApiPilot response carries a correlation ID in `meta.requestId` and
(optionally) in a response header. The ID is resolved per request by
`resolve_correlation_id`.

## Resolution order

1. **Absent header** → generate a GUIDv7 (`generate_guid_v7`).
2. **Present + matches `validation_pattern`** → use incoming.
3. **Present + no match** → apply `invalid_id_policy`:
   - `replace` (default) → generate a new GUIDv7.
   - `reject` → 400 `VALIDATION_ERROR`.
   - `useAsIs` → use incoming and log a warning.

## Options (`CorrelationOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `header_name` | `X-Request-Id` | Incoming header to read. |
| `validation_pattern` | `^[A-Za-z0-9][A-Za-z0-9\-_]{0,127}$` | None disables validation. |
| `invalid_id_policy` | `replace` | `replace` \| `reject` \| `useAsIs`. |
| `echo_in_response_header` | True | Emit the ID as a response header. |
| `echo_in_response_body` | True | Include in `meta.requestId`. |

## GUIDv7

`generate_guid_v7` produces RFC 9562 UUIDv7: 48-bit big-endian
unix-ms timestamp + version `7` + variant `10xx` + random. Time-ordered,
lexicographically sortable, 122 bits of randomness.

## Python usage

```python
options = ApiPilotOptions()
options.correlation.header_name = "X-Correlation-Id"
options.correlation.invalid_id_policy = InvalidIdPolicy.REJECT
```

The resolved ID is stored on the ASGI scope as
`scope["apipilot.request_id"]`.
