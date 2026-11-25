# Observability

## Diagnostics surface (`apipilot.asgi.diagnostics`)

`diagnostics(options, binding)` returns non-fatal configuration warnings â€”
never secrets, never request data.

| Code | Level | Condition |
| --- | --- | --- |
| `csrf-no-binding` | warning | CSRF enabled but no subject/session/preauth extractor configured. |
| `origin-empty-allowlist` | warning | Origin enabled with empty `allowed_origins` (rejects all). |
| `rate-limit-defaults` | info | Rate limit enabled with default window/limit. |

Call at startup and log the result:

```python
from apipilot.asgi import diagnostics

for d in diagnostics.diagnostics(options, binding):
    logging.getLogger("apipilot").log(
        logging.WARNING if d.level == "warning" else logging.INFO,
        "%s: %s", d.code, d.message,
    )
```

## Logging

The middleware emits warning-level logs for security rejections (origin,
fetch-metadata, cookie, CSRF) with the rejection reason via the
`logging` module.

## Correlation in logs

Every response carries `meta.requestId`; log it alongside request logs
to trace a request across services.

## Pipeline counters (`apipilot.asgi.observability.Metrics`)

`ApiPilotOptions.metrics` accepts a `Metrics` instance; when `None` the
shared `DEFAULT_METRICS` is used. Counters are in-memory and
per-process — export `snapshot()` to your metrics pipeline.

| Counter | Incremented when |
| --- | --- |
| `csrf.issued` | CSRF bootstrap endpoint issues a token |
| `csrf.validated` | CSRF token validates successfully |
| `csrf.rejected` | CSRF header missing, binding unresolvable, or token invalid |
| `csrf.expired` | CSRF token past `token_lifetime_seconds` |
| `rate_limited` | Rate limiter rejects a request |
| `validation_failed` | Pagination/validation stage rejects |
| `origin_rejected` | Origin policy rejects |
| `fetch_metadata_rejected` | Fetch Metadata policy rejects |
| `cookie_rejected` | Cookie policy rejects |

```python
from apipilot.asgi import observability

options = ApiPilotOptions(metrics=observability.Metrics())
# ... later:
snap = options.metrics.snapshot()  # dict[str, int]
```

## Log redaction (`redact_string`, `redact_map`)

`DEFAULT_REDACTION_POLICY` masks sensitive keys (password, token,
authorization, cookie, csrf, api_key, ...) and `Bearer` tokens. Use
before writing request data to logs:

```python
from apipilot.asgi import observability

safe = observability.redact_string(raw)
safe_map = observability.redact_map(fields)
```
