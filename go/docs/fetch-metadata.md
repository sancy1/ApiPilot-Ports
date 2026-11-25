# Fetch metadata

Fetch metadata evaluates the `Sec-Fetch-Site` and `Sec-Fetch-Mode` request
headers (Fetch Metadata spec) as an additional CSRF signal. Rejections
emit `CSRF_ORIGIN_REJECTED` (403).

## Profiles (`core.FetchMetadataOptions`)

| Profile | Behavior |
| --- | --- |
| `off` | Disabled (default). |
| `compat` | Same rules as `strict`; kept for forward compatibility. |
| `strict` | Enforce allowed values. |

## Options

| Field | Default | Notes |
| --- | --- | --- |
| `Profile` | `off` | `off` \| `compat` \| `strict`. |
| `AllowedSiteValues` | `["same-origin","same-site","none"]` | `cross-site` rejected. |
| `AllowedModeValues` | `["cors","same-origin","navigate"]` | `no-cors` rejected. |
| `AllowMissingHeaders` | true | Missing headers → allow (non-browser clients). |

## Decision reasons

| Reason | Meaning |
| --- | --- |
| `missingSiteHeader` | `Sec-Fetch-Site` absent and `AllowMissingHeaders=false`. |
| `malformedSiteHeader` | Site value not in the known set. |
| `disallowedSiteValue` | Site value not in `AllowedSiteValues`. |
| `malformedModeHeader` | Mode value not in the known set. |
| `disallowedModeValue` | Mode value not in `AllowedModeValues`. |

## Rules

- Comparison is case-insensitive; values are trimmed.
- `Sec-Fetch-Site: none` (user-initiated navigation) is allowed by default.
- Missing headers are allowed by default so non-browser clients (curl,
  server-to-server) are not broken; set `AllowMissingHeaders=false` for
  browser-only APIs.
- Runs on unsafe methods only, after origin policy.

## Go usage

```go
opts.FetchMetadata = core.FetchMetadataOptions{
    Profile:            core.FetchMetadataStrict,
    AllowMissingHeaders: false,
}
```
