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
| `allowedSiteValues` | `["same-origin","same-site","none"]` | `cross-site` rejected. |
| `allowedModeValues` | `["cors","same-origin","navigate"]` | `no-cors` rejected. |
| `allowMissingHeaders` | true | Missing headers → allow (non-browser clients). |

## Decision reasons

| Reason | Meaning |
| --- | --- |
| `missingSiteHeader` | `Sec-Fetch-Site` absent and `allowMissingHeaders=false`. |
| `malformedSiteHeader` | Site value not in the known set. |
| `disallowedSiteValue` | Site value not in `allowedSiteValues`. |
| `malformedModeHeader` | Mode value not in the known set. |
| `disallowedModeValue` | Mode value not in `allowedModeValues`. |

## Rules

- Comparison is case-insensitive; values are trimmed.
- `Sec-Fetch-Site: none` (user-initiated navigation) is allowed by default.
- Missing headers are allowed by default so non-browser clients (curl,
  server-to-server) are not broken; set `allowMissingHeaders=false` for
  browser-only APIs.
- Runs on unsafe methods only, after origin policy.

## TypeScript usage

```ts
app.use(apiPilot({
  fetchMetadata: {
    profile: "strict",
    allowMissingHeaders: false,
  },
}));
```
