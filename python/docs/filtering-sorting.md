# Filtering and sorting

Non-control query parameters are collected into a filter map; `sort` +
`direction` form the sort request. Both are parsed by
`parse_pagination_query`.

## Sort

- `sort=<field>` — field name passed through verbatim (no normalization).
- `direction=asc|desc` — case-insensitive; defaults to `asc` when `sort`
  is present without `direction`.
- `direction` without `sort` → validation error on `sort`.
- Custom parsers: `PaginationOptions.sort_parser` /
  `sort_direction_parser` allow framework-specific sort expressions.

## Filters

- Every query parameter not in `{page, pageSize, sort, direction}` is a
  filter candidate.
- `is_filter_parameter(key)` decides membership when provided; otherwise
  `not strict_query_validation` treats all non-control params as filters.
- `strict_query_validation=True` rejects unrecognized params with
  `VALIDATION_ERROR` ("This query parameter is not recognized.").
- Filter values are strings; repeated params keep the first value.
- The result is `FilterRequest(parameters={...})` — application code maps
  these to its query layer.

## Python usage

```python
parsed = scope.get("apipilot.pagination")
if parsed.sort:
    # parsed.sort.field, parsed.sort.direction
if parsed.filter:
    # parsed.filter.parameters["status"]
```
