# Pagination

ApiPilot pagination is a query-parameter contract parsed by
`core.ParsePaginationQuery`. Enable with `Options.PaginationEnabled = true`.

## Parameters

| Param | Default | Rules |
| --- | --- | --- |
| `page` | 1 | Integer ≥ `PageNumberBase` (default 1). |
| `pageSize` | 20 | Integer 1–`MaxPageSize` (default 100). |
| `sort` | — | Field name; requires `direction` or defaults `asc`. |
| `direction` | `asc` | `asc` \| `desc` (case-insensitive). |
| any other | — | Treated as filters unless `StrictQueryValidation`. |

Custom names via `PaginationOptions.ParameterNames`
(`page`, `pageSize`, `sort`, `direction`).

## Validation errors

Invalid values produce `VALIDATION_ERROR` (400) with `error.fields` keyed
by parameter name:

- `page` — "The page value is not valid." / "must be at least N."
- `pageSize` — "not valid" / "at least 1" / "must not exceed N."
- `direction` — "not valid" / "sort field is required when direction is specified."
- unknown params under `StrictQueryValidation` — "This query parameter is not recognized."

## Page number base

`PageNumberBase` (default 1) supports 0-based APIs: wire page `0` maps to
internal page 1 via `core.WirePageToInternal`.

## Response block

`core.BuildPagination(totalItems, page, pageSize)` returns the six-field
block (`page`, `pageSize`, `totalItems`, `totalPages`, `hasNext`,
`hasPrevious`). `totalPages` is at least 1; `hasNext`/`hasPrevious` are
computed from the internal page.

## Go usage

```go
opts.PaginationEnabled = true
opts.Pagination.MaxPageSize = 200

// In handler:
parsed, ok := httpapi.Pagination(r) // (core.ParsedPaginationQuery, bool)
if ok {
    // parsed.PageRequest.Page, parsed.PageRequest.PageSize
}
page := core.ApiPagination{
    Page: parsed.PageRequest.Page, PageSize: parsed.PageRequest.PageSize,
    TotalItems: total, TotalPages: totalPages,
    HasNext: hasNext, HasPrevious: hasPrev,
}
httpapi.SendPaginated(w, httpapi.RequestID(r), items, page, 200, nil)
```
