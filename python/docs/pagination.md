# Pagination

ApiPilot pagination is a query-parameter contract parsed by
`parse_pagination_query`. Enable with `options.pagination_enabled = True`.

## Parameters

| Param | Default | Rules |
| --- | --- | --- |
| `page` | 1 | Integer ≥ `page_number_base` (default 1). |
| `pageSize` | 20 | Integer 1–`max_page_size` (default 100). |
| `sort` | — | Field name; requires `direction` or defaults `asc`. |
| `direction` | `asc` | `asc` \| `desc` (case-insensitive). |
| any other | — | Treated as filters unless `strict_query_validation`. |

Custom names via `PaginationOptions.parameter_names`
(`page`, `pageSize`, `sort`, `direction`).

## Validation errors

Invalid values produce `VALIDATION_ERROR` (400) with `error.fields` keyed
by parameter name:

- `page` — "The page value is not valid." / "must be at least N."
- `pageSize` — "not valid" / "at least 1" / "must not exceed N."
- `direction` — "not valid" / "sort field is required when direction is specified."
- unknown params under `strict_query_validation` — "This query parameter is not recognized."

## Page number base

`page_number_base` (default 1) supports 0-based APIs: wire page `0` maps to
internal page 1 via `wire_page_to_internal`.

## Response block

`build_pagination(total_items, page, page_size)` returns the six-field
block (`page`, `pageSize`, `totalItems`, `totalPages`, `hasNext`,
`hasPrevious`). `totalPages` is at least 1; `hasNext`/`hasPrevious` are
computed from the internal page.

## Python usage

```python
options.pagination_enabled = True
options.pagination.max_page_size = 200

# In handler:
parsed = scope.get("apipilot.pagination")  # ParsedPaginationQuery
await send_paginated(send, request_id, items, pagination, 200, None, None)
```
