# Rate limiting

Fixed-window rate limiting per client key. Rejections emit
`RATE_LIMITED` (429) with an optional `Retry-After` header.

## Options (`RateLimitOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `enabled` | false | Master switch. |
| `requestsPerWindow` | 100 | Max requests per window per key. |
| `windowSeconds` | 60 | Fixed window length. |
| `message` | `"Too many requests. Retry later."` | Error message; empty → default. |
| `retryAfterSeconds` | 0 | Fixed header value; 0 → computed from window. |
| `keyExtractor` | null | Custom key func; null → remote IP. |

## Behavior

- Window is fixed: `windowStart = now - (now % windowSeconds)`.
- First request in a window creates the counter; subsequent requests
  increment. At `requestsPerWindow` the request is rejected.
- `Retry-After` = whole seconds until the next window boundary
  (`windowSeconds - (now % windowSeconds)`), or the fixed
  `retryAfterSeconds` when > 0.
- The limiter is in-memory and per-process — see `multi-instance.md`.
- Runs after correlation, before content negotiation.

## TypeScript usage

```ts
await app.register(apipilot, {
  rateLimit: {
    enabled: true,
    requestsPerWindow: 60,
    windowSeconds: 60,
    keyExtractor: (request) => request.headers["x-api-key"] ?? "",
  },
});
```
