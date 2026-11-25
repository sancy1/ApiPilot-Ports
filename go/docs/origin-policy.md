# Origin policy

The origin policy rejects unsafe requests whose `Origin` (or `Referer`
fallback) is not allowlisted. Rejections emit `CSRF_ORIGIN_REJECTED` (403).

## Options (`httpapi.OriginPolicyOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `Enabled` | false | Master switch. |
| `AllowedOrigins` | `[]` | Exact origins; empty + enabled = reject all. |
| `MatchMode` | `exact` | `exact` \| `anyPortSameHost` \| `sameSite`. |
| `RequireOriginHeader` | true | Reject when neither Origin nor Referer present. |
| `AllowRefererFallback` | true | Use Referer origin when Origin absent. |

## Match modes

- `exact` — scheme + host + port must match exactly.
- `anyPortSameHost` — scheme + host match; port ignored.
- `sameSite` — always false (reserved; same-site is implied by fetch metadata).

## Parsing rules (`core.TryParseOrigin`)

- Accepts `scheme://host[:port]` only.
- Rejects paths, query strings, fragments, userinfo, non-http(s) schemes,
  empty hosts, non-numeric ports.
- Default ports: 443 (https), 80 (http).
- Host is lowercased; scheme lowercased.

## Pipeline position

Runs after content negotiation, before fetch metadata and CSRF —
unsafe methods only (`GET`/`HEAD`/`OPTIONS`/`TRACE` skip).

## Go usage

```go
opts.Origin = httpapi.OriginPolicyOptions{
    Enabled:             true,
    AllowedOrigins:      []string{"https://app.example.com"},
    MatchMode:           "exact",
    RequireOriginHeader: true,
    AllowRefererFallback: true,
}
```
