# Rate limiting

Fixed-window rate limiting per client key. Rejections emit
`RATE_LIMITED` (429) with an optional `Retry-After` header.

## Options (`RateLimitOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `enabled` | False | Master switch. |
| `requests_per_window` | 100 | Max requests per window per key. |
| `window_seconds` | 60 | Fixed window length. |
| `message` | `"Too many requests. Retry later."` | Error message; empty → default. |
| `retry_after_seconds` | 0 | Fixed header value; 0 → computed from window. |
| `key_extractor` | None | Custom key func; None → remote IP. |

## Behavior

- Window is fixed: `window_start = now - (now % window_seconds)`.
- First request in a window creates the counter; subsequent requests
  increment. At `requests_per_window` the request is rejected.
- `Retry-After` = whole seconds until the next window boundary
  (`window_seconds - (now % window_seconds)`), or the fixed
  `retry_after_seconds` when > 0.
- The limiter is in-memory and per-process — see `multi-instance.md`.
- Runs after correlation, before content negotiation.

## Python usage

```python
options.rate_limit = RateLimitOptions(
    enabled=True,
    requests_per_window=60,
    window_seconds=60,
    key_extractor=lambda scope: scope.get("api_key", ""),
)
```
