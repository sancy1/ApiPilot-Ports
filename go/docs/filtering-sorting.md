# Filtering and sorting

Non-control query parameters are collected into a filter map; `sort` +
`direction` form the sort request. Both are parsed by
`core.ParsePaginationQuery`.

## Sort

- `sort=<field>` — field name passed through verbatim (no normalization).
- `direction=asc|desc` — case-insensitive; defaults to `asc` when `sort`
  is present without `direction`.
- `direction` without `sort` → validation error on `sort`.
- Custom parsers: `PaginationOptions.SortParser` /
  `SortDirectionParser` allow framework-specific sort expressions.

## Filters

- Every query parameter not in `{page, pageSize, sort, direction}` is a
  filter candidate.
- `IsFilterParameter(key)` decides membership when provided; otherwise
  `!StrictQueryValidation` treats all non-control params as filters.
- `StrictQueryValidation=true` rejects unrecognized params with
  `VALIDATION_ERROR` ("This query parameter is not recognized.").
- Filter values are strings; repeated params keep the first value.
- The result is `FilterRequest{Parameters: map[string]string}` —
  application code maps these to its query layer.

## Go usage

```go
parsed, ok := httpapi.Pagination(r)
if ok && parsed.Sort != nil {
    // parsed.Sort.Field, parsed.Sort.Direction
}
if ok && parsed.Filter != nil {
    // parsed.Filter.Parameters["status"]
}
```
