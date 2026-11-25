# Multi-instance deployment

## Shared state requirements

| Component | Shared? | Notes |
| --- | --- | --- |
| CSRF key ring | **Yes** | All instances must verify tokens issued by any instance. Use the same `APIPILOT_CSRF_KEYS`. |
| Rate limiter | No | Per-process fixed window. Limits are per-instance, not global. |
| Correlation IDs | No | Generated per request; no shared state. |
| Session binding | Yes (app-level) | Subject/session extractors read from the app's session store. |

## Rate limiting at scale

The built-in limiter is in-memory. For global limits:

- Put a rate-limiting reverse proxy (nginx, Envoy, API gateway) in front.
- Or replace `RateLimit.KeyExtractor` + a shared store via a custom
  middleware — the port's limiter is intentionally simple.

## CSRF key rotation

`CsrfKeyRing` supports multiple keys: `activeKeyId` signs new tokens;
all keys in `Keys` verify. Rotate by adding the new key, switching
`activeKeyId`, and removing the old key after token lifetime expires.

## Sticky sessions

Not required — CSRF tokens are self-contained (HMAC + binding), not
server-side session state. Any instance can validate any token.
