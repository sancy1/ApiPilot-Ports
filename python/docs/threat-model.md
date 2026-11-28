# Threat model

## Assets

- Session integrity (no cross-site request forgery).
- Response integrity (no MIME sniffing, no cache poisoning).
- Correlation integrity (no log injection via request IDs).

## Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| CSRF | AES-256-GCM encrypted synchronizer token bound to subject/session/preauth; origin + fetch-metadata + cookie policy defense-in-depth. |
| Token replay | Binding fingerprint changes on identity change; `token_lifetime_seconds` expiry. |
| Origin bypass | Exact origin matching; Referer fallback only when Origin absent; `require_origin_header` option. |
| Fetch-metadata bypass | `allow_missing_headers=False` for browser-only APIs; strict value allowlists. |
| Cookie tossing | `SameSite=None` requires `Secure`; profile validation on session cookies. |
| Log injection | Correlation ID validated against `validation_pattern`; `invalid_id_policy` chooses replace / reject / use-as-is. |
| Rate-limit bypass | Per-key fixed window; `key_extractor` for API-key-aware limiting. |
| Key compromise | `CsrfKeyRing` supports multiple keys for rotation; keys from env, never in code. |

## Out of scope

- XSS, SQL injection, business-logic authorization — application concerns.
- DDoS at the network layer — use a CDN/reverse proxy.
- Token theft via XSS — HttpOnly cookies mitigate; CSP is app-level.

## Fail-closed posture

Every security stage fails closed: missing binding → 403, missing
headers → 403 (when configured), invalid token → 403. There is no
"allow on error" path.
