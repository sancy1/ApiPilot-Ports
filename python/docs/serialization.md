# Serialization

ApiPilot responses are JSON. The envelope keys are pinned; application
`data` payloads follow the configured naming policy.

## JSON options (`JsonOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `camel_case` | True | `camelCase` property names. |
| `indent` | False | Pretty-print (development only). |

Python dicts serialize as-is; `camel_case` applies to envelope keys
(already camelCase) — application payloads use their own key style.

## Enum serialization

Python has no enum type; applications serialize enums as strings or
numbers per their own types. The conformance contract only pins envelope
keys.

## Date serialization

`meta.timestamp` is always ISO 8601 UTC with millisecond precision
(e.g. `2026-11-24T19:06:23.937Z`). Application `data` dates follow the
application's own serialization (e.g. Pydantic, dataclasses).

## Content-Type

All ApiPilot envelopes are `application/json; charset=utf-8`. The
content-negotiation stage rejects non-JSON request bodies on
body-carrying methods.

## Python usage

```python
await send_success(send, request_id, {"name": user.name}, 200, None, None)
```
