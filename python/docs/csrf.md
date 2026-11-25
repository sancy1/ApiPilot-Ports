# CSRF protection

ApiPilot CSRF uses a double-submit pattern: a bootstrap endpoint issues an
HMAC-protected token; unsafe requests must echo it in a header.

## Token format

```
<base64url(payload)>.<base64url(hmac-sha256)>
```

Payload (pipe-delimited, `encode_csrf_payload`):

```
<issuedAtUnixSeconds>|<randomBase64Url>|<bindingFingerprint>
```

- `issuedAtUnixSeconds` — integer seconds since epoch.
- `randomBase64Url` — CSPRNG entropy (`token_entropy_bytes`, default 32).
- `bindingFingerprint` — `csrf_binding_fingerprint(source, kind)`,
  a truncated SHA-256 over `ApiPilot.Csrf.Binding.v1|kind|source`.

## Binding resolution

`DefaultCsrfBindingResolver` resolves in order — never anonymous:

1. **subject** — authenticated user id (`subject_extractor`).
2. **session** — session id (`session_extractor`).
3. **preauth** — pre-auth source such as a device fingerprint
   (`pre_auth_source`).

If all resolve to empty, the binding is `None` and CSRF **fails closed**
(bootstrap 403, validation 403).

## Pipeline

1. `GET <bootstrap_path>` (default `/api/csrf`) → issues
   `{ "success": true, "data": { "token": "..." } }` with
   `Cache-Control: no-store`.
2. Unsafe methods (`POST`/`PUT`/`PATCH`/`DELETE` by default) require the
   token in `header_name` (default `X-CSRF-Token`).
3. The bootstrap path is **exempt** from validation on every method.

## Validation outcomes → codes

| Outcome | Code |
| --- | --- |
| Header absent/empty | `CSRF_HEADER_MISSING` |
| Bad signature, malformed payload, binding mismatch | `CSRF_TOKEN_INVALID` |
| `issuedAt` older than `token_lifetime_seconds` | `CSRF_TOKEN_EXPIRED` |

## Key management

`CsrfKeyRing` holds AES-256 key material for the protector.
`key_ring_from_env()` reads `APIPILOT_CSRF_KEYS`
(JSON: `{"activeKeyId":"k1","keys":{"k1":"<base64>"}}`).
`generate_key_material()` produces a 32-byte base64 key.

## Python usage

```python
options = ApiPilotOptions()
options.csrf.enabled = True
options.csrf.token_lifetime_seconds = 7200
options.csrf.protected_methods = ["POST", "PUT", "PATCH", "DELETE"]

binding = DefaultCsrfBindingResolver(
    subject_extractor=lambda scope: scope.get("user", {}).get("id", ""),
)
app = ApiPilotASGIMiddleware(app, options=options, binding_resolver=binding)
```

## Rotation store (`apipilot.asgi.csrf_extras`)

Optional server-side store of per-binding rotation markers. A token
whose `issued_at` predates the binding's marker validates as
`"rotated"` (mapped to `CSRF_TOKEN_INVALID` on the wire).

```python
from apipilot.asgi import csrf_extras

store = csrf_extras.InMemoryRotationStore()
csrf_extras.attach_rotation_store(service, store)
```

`RotationStore` is a protocol (`get_rotation_marker`,
`set_rotation_marker`, `clear_rotation_marker`) � back it with Redis
or a database for multi-instance deployments.
`csrf_extras.mark_rotated(service, fingerprint)` records a marker.

## Transition listener (`CsrfTransitionListener`)

Issues a fresh token on login and clears the rotation marker on logout.
Never authenticates users or writes cookies � the application owns its
session lifecycle.

```python
listener = csrf_extras.CsrfTransitionListener(service, binding, store)
token = listener.on_login(scope)              # None when no binding
token = listener.on_login_with_binding(src, kind)
listener.on_logout(scope)                     # clears marker
listener.on_logout_with_fingerprint(fp)       # explicit fingerprint
```

## Endpoint policy resolver (`resolve_endpoint_policy`)

Combines per-route flags into the effective policy with precedence
**require > skip > useGlobal**.

```python
policy = csrf_extras.resolve_endpoint_policy(require_csrf, skip_csrf)
# "require" | "skip" | "useGlobal"
```

## Rotation policy & requirement

`CsrfOptions.rotation_policy` mirrors `CsrfRotationPolicy` (C#):

- `"onBootstrap"` (default) — bootstrap records a rotation marker; tokens
  issued before the latest bootstrap validate as `"rotated"`.
- `"onWindow"` — same marker semantics; reserved for window-based rotation.
- `"never"` — no marker is recorded; all unexpired tokens stay valid.

`CsrfOptions.rotation_requirement` mirrors `CsrfRotationRequirement` (C#):

- `"optional"` (default) — store may be omitted; rotation checks are skipped.
- `"required"` — `ApiPilotASGIMiddleware` raises `ValueError` at startup
  when `rotation_store` is `None`, failing fast.

When a store is configured, `CsrfService.validate_token` returns outcome
`"rotated"` for superseded tokens and the middleware maps it to
`CSRF_TOKEN_INVALID` (HTTP 400).
