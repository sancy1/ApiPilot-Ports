# Filtering and sorting

Non-control query parameters are collected into a filter map; `sort` +
`direction` form the sort request. Both are parsed by
`parsePaginationQuery`.

## Sort

- `sort=<field>` — field name passed through verbatim (no normalization).
- `direction=asc|desc` — case-insensitive; defaults to `asc` when `sort`
  is present without `direction`.
- `direction` without `sort` → validation error on `sort`.
- Custom parsers: `PaginationOptions.sortParser` /
  `sortDirectionParser` allow framework-specific sort expressions.

## Filters

- Every query parameter not in `{page, pageSize, sort, direction}` is a
  filter candidate.
- `isFilterParameter(key)` decides membership when provided; otherwise
  `!strictQueryValidation` treats all non-control params as filters.
- `strictQueryValidation=true` rejects unrecognized params with
  `VALIDATION_ERROR` ("This query parameter is not recognized.").
- Filter values are strings; repeated params keep the first value.
- The result is `FilterRequest({ parameters: {...} })` — application code
  maps these to its query layer.

## TypeScript usage

```ts
const ctx = getPagination(req); // PaginationContext | null
if (ctx?.sort) {
  // ctx.sort.field, ctx.sort.direction
}
if (ctx?.filter) {
  // ctx.filter.parameters["status"]
}
```
