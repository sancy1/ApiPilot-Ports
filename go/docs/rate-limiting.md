# Rate limiting

Fixed-window rate limiting per client key. Rejections emit
`RATE_LIMITED` (429) with an optional `Retry-After` header.

## Options (`httpapi.RateLimitOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `Enabled` | false | Master switch. |
| `RequestsPerWindow` | 100 | Max requests per window per key. |
| `WindowSeconds` | 60 | Fixed window length. |
| `Message` | `"Too many requests. Retry later."` | Error message; empty → default. |
| `RetryAfterSeconds` | 0 | Fixed header value; 0 → computed from window. |
| `KeyExtractor` | nil | Custom key func; nil → remote IP. |

## Behavior

- Window is fixed: `windowStart = now - (now % windowSeconds)`.
- First request in a window creates the counter; subsequent requests
  increment. At `RequestsPerWindow` the request is rejected.
- `Retry-After` = whole seconds until the next window boundary
  (`windowSeconds - (now % windowSeconds)`), or the fixed
  `RetryAfterSeconds` when > 0.
- The limiter is in-memory and per-process — see `multi-instance.md`.
- Runs after correlation, before content negotiation.

## Go usage

```go
opts.RateLimit = httpapi.RateLimitOptions{
    Enabled:            true,
    RequestsPerWindow:  60,
    WindowSeconds:      60,
    KeyExtractor: func(r *http.Request) string {
        return r.Header.Get("X-Api-Key") // fall back to IP when empty
    },
}
```
