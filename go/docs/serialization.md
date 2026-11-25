# Serialization

ApiPilot responses are JSON. The envelope keys are pinned; application
`data` payloads follow the configured naming policy.

## JSON options (`httpapi.JsonOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `CamelCase` | true | `camelCase` property names. |
| `Indent` | false | Pretty-print (development only). |

The Go adapter marshals with `encoding/json`; struct tags control field
names. `CamelCase=false` emits Go field names verbatim.

## Enum serialization

Go has no enum type; applications serialize enums as strings or numbers
per their own types. The conformance contract only pins envelope keys.

## Date serialization

`meta.timestamp` is always ISO 8601 UTC with millisecond precision
(e.g. `2026-11-24T19:06:23.937Z`). Application `data` dates follow the
application's own marshaling.

## Content-Type

All ApiPilot envelopes are `application/json; charset=utf-8`. The
content-negotiation stage rejects non-JSON request bodies on
body-carrying methods.

## Go usage

```go
type User struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}
httpapi.SendSuccess(w, httpapi.RequestID(r), user, 200, nil, nil)
```
