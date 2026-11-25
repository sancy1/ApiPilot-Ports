# Serialization

ApiPilot responses are JSON. The envelope keys are pinned; application
`data` payloads follow the configured naming policy.

## JSON options (`JsonOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `camelCase` | true | `camelCase` property names. |
| `indent` | false | Pretty-print (development only). |

TypeScript objects serialize as-is; `camelCase` applies to envelope keys
(already camelCase) — application payloads use their own key style.

## Enum serialization

TypeScript enums/union types serialize as strings or numbers per their
definition. The conformance contract only pins envelope keys.

## Date serialization

`meta.timestamp` is always ISO 8601 UTC with millisecond precision
(e.g. `2026-11-24T19:06:23.937Z`). Application `data` dates follow the
application's own serialization (e.g. `Date.toISOString()`).

## Content-Type

All ApiPilot envelopes are `application/json; charset=utf-8`. The
content-negotiation stage rejects non-JSON request bodies on
body-carrying methods.

## TypeScript usage

```ts
await sendSuccess(reply, requestId, { name: user.name }, 200, null, null);
```
