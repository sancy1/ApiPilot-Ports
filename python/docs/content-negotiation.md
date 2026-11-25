# Content negotiation

ApiPilot negotiates `Accept` (response) and `Content-Type` (request body)
against a fixed JSON contract. Failures emit `NOT_ACCEPTABLE` (406) or
`UNSUPPORTED_MEDIA_TYPE` (415).

## Options (`ContentNegotiationOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `supported_media_types` | `["application/json"]` | Exact match after parameter strip. |
| `accept_wildcard` | True | `*/*` in Accept is acceptable. |
| `accept_missing` | True | Missing Accept header is acceptable. |
| `accept_missing_content_type` | False | Missing Content-Type on body methods → 415. |

## Rules

- Media type comparison strips parameters (`; charset=utf-8`) and is
  case-insensitive.
- `Accept` q-values are ignored — presence of a supported type anywhere
  in the list accepts.
- Type wildcards (`application/*`) are **not** honored — only `*/*`.
- Body-carrying methods (`POST`, `PUT`, `PATCH`) require a supported
  `Content-Type` unless `accept_missing_content_type` is True.
- `GET`, `HEAD`, `DELETE`, `OPTIONS`, `TRACE` skip Content-Type checks.
- Accept is evaluated before Content-Type; a 406 wins over a 415.

## Python usage

```python
options.content_negotiation = ContentNegotiationOptions(
    supported_media_types=["application/json"],
    accept_wildcard=True,
    accept_missing=True,
    accept_missing_content_type=False,
)
```
