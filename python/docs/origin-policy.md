# Origin policy

The origin policy rejects unsafe requests whose `Origin` (or `Referer`
fallback) is not allowlisted. Rejections emit `CSRF_ORIGIN_REJECTED` (403).

## Options (`OriginPolicyOptions`)

| Field | Default | Notes |
| --- | --- | --- |
| `enabled` | False | Master switch. |
| `allowed_origins` | `[]` | Exact origins; empty + enabled = reject all. |
| `match_mode` | `exact` | `exact` \| `anyPortSameHost` \| `sameSite`. |
| `require_origin_header` | True | Reject when neither Origin nor Referer present. |
| `allow_referer_fallback` | True | Use Referer origin when Origin absent. |

## Match modes

- `exact` — scheme + host + port must match exactly.
- `anyPortSameHost` — scheme + host match; port ignored.
- `sameSite` — always false (reserved; same-site is implied by fetch metadata).

## Parsing rules (`try_parse_origin`)

- Accepts `scheme://host[:port]` only.
- Rejects paths, query strings, fragments, userinfo, non-http(s) schemes,
  empty hosts, non-numeric ports.
- Default ports: 443 (https), 80 (http).
- Host is lowercased; scheme lowercased.

## Pipeline position

Runs after content negotiation, before fetch metadata and CSRF —
unsafe methods only (`GET`/`HEAD`/`OPTIONS`/`TRACE` skip).

## Python usage

```python
options.origin = OriginPolicyOptions(
    enabled=True,
    allowed_origins=["https://app.example.com"],
    match_mode="exact",
    require_origin_header=True,
    allow_referer_fallback=True,
)
```
