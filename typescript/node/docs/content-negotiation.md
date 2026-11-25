# Content negotiation

ApiPilot negotiates `Accept` (response) and `Content-Type` (request body)
against a fixed JSON contract. Failures emit `NOT_ACCEPTABLE` (406) or
`UNSUPPORTED_MEDIA_TYPE` (415).

## Options (`ContentNegotiationOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `supportedMediaTypes` | `["application/json"]` | Exact match after parameter strip. |
| `acceptWildcard` | true | `*/*` in Accept is acceptable. |
| `acceptMissing` | true | Missing Accept header is acceptable. |
| `acceptMissingContentType` | false | Missing Content-Type on body methods → 415. |

## Rules

- Media type comparison strips parameters (`; charset=utf-8`) and is
  case-insensitive.
- `Accept` q-values are ignored — presence of a supported type anywhere
  in the list accepts.
- Type wildcards (`application/*`) are **not** honored — only `*/*`.
- Body-carrying methods (`POST`, `PUT`, `PATCH`) require a supported
  `Content-Type` unless `acceptMissingContentType` is true.
- `GET`, `HEAD`, `DELETE`, `OPTIONS`, `TRACE` skip Content-Type checks.
- Accept is evaluated before Content-Type; a 406 wins over a 415.

## TypeScript usage

```ts
app.use(apiPilot({
  contentNegotiation: {
    supportedMediaTypes: ["application/json"],
    acceptWildcard: true,
    acceptMissing: true,
    acceptMissingContentType: false,
  },
}));
```
