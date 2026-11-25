# Pagination

ApiPilot pagination is a query-parameter contract parsed by
`parsePaginationQuery`. Enable with `paginationEnabled: true`.

## Parameters

| Param | Default | Rules |
| --- | --- | --- |
| `page` | 1 | Integer ≥ `pageNumberBase` (default 1). |
| `pageSize` | 20 | Integer 1–`maxPageSize` (default 100). |
| `sort` | — | Field name; requires `direction` or defaults `asc`. |
| `direction` | `asc` | `asc` \| `desc` (case-insensitive). |
| any other | — | Treated as filters unless `strictQueryValidation`. |

Custom names via `PaginationOptions.parameterNames`
(`page`, `pageSize`, `sort`, `direction`).

## Validation errors

Invalid values produce `VALIDATION_ERROR` (400) with `error.fields` keyed
by parameter name:

- `page` — "The page value is not valid." / "must be at least N."
- `pageSize` — "not valid" / "at least 1" / "must not exceed N."
- `direction` — "not valid" / "sort field is required when direction is specified."
- unknown params under `strictQueryValidation` — "This query parameter is not recognized."

## Page number base

`pageNumberBase` (default 1) supports 0-based APIs: wire page `0` maps to
internal page 1 via `wirePageToInternal`.

## Response block

`buildPagination(totalItems, page, pageSize)` returns the six-field
block (`page`, `pageSize`, `totalItems`, `totalPages`, `hasNext`,
`hasPrevious`). `totalPages` is at least 1; `hasNext`/`hasPrevious` are
computed from the internal page.

## TypeScript usage

```ts
app.use(apiPilot({
  paginationEnabled: true,
  pagination: { maxPageSize: 200 },
}));

// In handler:
const ctx = getPagination(req); // PaginationContext | null
// ctx.pageRequest: { page, pageSize }
// ctx.sort / ctx.filter: parsed sort and filter requests
const pagination = buildPagination(totalItems, ctx.pageRequest.page, ctx.pageRequest.pageSize);
sendPaginated(req, res, items, pagination, { status: 200 });
```
