# Observability

## Diagnostics surface (`httpapi.Diagnostics`)

`Diagnostics(opts, binding)` returns non-fatal configuration warnings â€”
never secrets, never request data.

| Code | Level | Condition |
| --- | --- | --- |
| `csrf-no-binding` | warning | CSRF enabled but no subject/session/preauth extractor configured. |
| `origin-empty-allowlist` | warning | Origin enabled with empty `AllowedOrigins` (rejects all). |
| `rate-limit-defaults` | info | Rate limit enabled with default window/limit. |

Call at startup and log the result:

```go
diags := httpapi.Diagnostics(opts, binding)
for _, d := range diags {
    log.Printf("%s: %s", d.Level, d.Message)
}
```

## Logging

The middleware emits warn-level logs for security rejections (origin,
fetch-metadata, cookie, CSRF) with the rejection reason. Attach a
`*log.Logger` via `Options.Logger`.

## Correlation in logs

Every response carries `meta.requestId`; log it alongside request logs
to trace a request across services.

## Pipeline counters (`httpapi.Metrics`)

`Options.Metrics` accepts a `*httpapi.Metrics` instance; when nil the
shared `httpapi.DefaultMetrics` is used. Counters are in-memory and
per-process — export `Snapshot()` to your metrics pipeline.

| Counter | Incremented when |
| --- | --- |
| `csrf.issued` | CSRF bootstrap endpoint issues a token |
| `csrf.validated` | CSRF token validates successfully |
| `csrf.rejected` | CSRF header missing, binding unresolvable, or token invalid |
| `csrf.expired` | CSRF token past `TokenLifetimeSeconds` |
| `rate_limited` | Rate limiter rejects a request |
| `validation_failed` | Pagination/validation stage rejects |
| `origin_rejected` | Origin policy rejects |
| `fetch_metadata_rejected` | Fetch Metadata policy rejects |
| `cookie_rejected` | Cookie policy rejects |

```go
opts := httpapi.DefaultOptions()
opts.Metrics = &httpapi.Metrics{}
// ... later:
snap := opts.Metrics.Snapshot() // map[string]int64
```

## Log redaction (`httpapi.RedactString`, `httpapi.RedactMap`)

`DefaultRedactionPolicy()` masks sensitive keys (password, token,
authorization, cookie, csrf, api_key, ...) and `Bearer` tokens in
free-form strings and maps. Use before writing request data to logs:

```go
safe := httpapi.RedactString(raw, httpapi.DefaultRedactionPolicy())
safeMap := httpapi.RedactMap(fields, httpapi.DefaultRedactionPolicy())
```
