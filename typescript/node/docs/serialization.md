# Serialization

ApiPilot responses are JSON. The envelope keys are pinned; application
`data` payloads follow the configured naming policy.

## JSON options (`JsonOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `namingPolicy` | `camelCase` | `camelCase` \| `snake_case` \| `passthrough`. |
| `enumMode` | `string` | `string` \| `number`. |
| `dateMode` | `iso8601` | `iso8601` \| `unixSeconds` \| `unixMs`. |
| `dictionaryKeyPolicy` | `namingPolicy` | Key transform for dictionary keys. |
| `ignoreNulls` | false | Omit null values from objects/arrays. |

`transformData(data, jsonOptions)` applies the policy to `data` payloads;
envelope keys are always pinned camelCase regardless of policy.

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
sendSuccess(req, res, { name: user.name }, { status: 200 });
// jsonOptions: { namingPolicy, enumMode, dateMode } via options
```
