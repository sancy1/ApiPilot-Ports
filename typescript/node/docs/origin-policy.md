# Origin policy

The origin policy rejects unsafe requests whose `Origin` (or `Referer`
fallback) is not allowlisted. Rejections emit `CSRF_ORIGIN_REJECTED` (403).

## Options (`OriginPolicyOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `enabled` | false | Master switch. |
| `allowedOrigins` | `[]` | Exact origins; empty + enabled = reject all. |
| `matchMode` | `exact` | `exact` \| `anyPortSameHost` \| `sameSite`. |
| `requireOriginHeader` | true | Reject when neither Origin nor Referer present. |
| `allowRefererFallback` | true | Use Referer origin when Origin absent. |

## Match modes

- `exact` — scheme + host + port must match exactly.
- `anyPortSameHost` — scheme + host match; port ignored.
- `sameSite` — always false (reserved; same-site is implied by fetch metadata).

## Parsing rules (`tryParseOrigin`)

- Accepts `scheme://host[:port]` only.
- Rejects paths, query strings, fragments, userinfo, non-http(s) schemes,
  empty hosts, non-numeric ports.
- Default ports: 443 (https), 80 (http).
- Host is lowercased; scheme lowercased.

## Pipeline position

Runs after content negotiation, before fetch metadata and CSRF —
unsafe methods only (`GET`/`HEAD`/`OPTIONS`/`TRACE` skip).

## TypeScript usage

```ts
app.use(apiPilot({
  origin: {
    enabled: true,
    allowedOrigins: ["https://app.example.com"],
    matchMode: "exact",
    requireOriginHeader: true,
    allowRefererFallback: true,
  },
}));
```
