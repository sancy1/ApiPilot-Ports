# Fetch metadata

Fetch metadata evaluates the `Sec-Fetch-Site` and `Sec-Fetch-Mode` request
headers (Fetch Metadata spec) as an additional CSRF signal. Rejections
emit `CSRF_ORIGIN_REJECTED` (403).

## Profiles (`FetchMetadataOptions`)

| Profile | Behavior |
| --- | --- |
| `off` | Disabled (default). |
| `compat` | Same rules as `strict`; kept for forward compatibility. |
| `strict` | Enforce allowed values. |

## Options

| Field | Default | Notes |
| --- | --- | --- |
| `profile` | `off` | `off` \| `compat` \| `strict`. |
| `allowed_site_values` | `["same-origin","same-site","none"]` | `cross-site` rejected. |
| `allowed_mode_values` | `["cors","same-origin","navigate"]` | `no-cors` rejected. |
| `allow_missing_headers` | True | Missing headers → allow (non-browser clients). |

## Decision reasons

| Reason | Meaning |
| --- | --- |
| `missingSiteHeader` | `Sec-Fetch-Site` absent and `allow_missing_headers=False`. |
| `malformedSiteHeader` | Site value not in the known set. |
| `disallowedSiteValue` | Site value not in `allowed_site_values`. |
| `malformedModeHeader` | Mode value not in the known set. |
| `disallowedModeValue` | Mode value not in `allowed_mode_values`. |

## Rules

- Comparison is case-insensitive; values are trimmed.
- `Sec-Fetch-Site: none` (user-initiated navigation) is allowed by default.
- Missing headers are allowed by default so non-browser clients (curl,
  server-to-server) are not broken; set `allow_missing_headers=False` for
  browser-only APIs.
- Runs on unsafe methods only, after origin policy.

## Python usage

```python
options.fetch_metadata = FetchMetadataOptions(
    profile=FetchMetadataProfile.STRICT,
    allow_missing_headers=False,
)
```
