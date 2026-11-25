# CSRF protection

ApiPilot CSRF uses a double-submit pattern: a bootstrap endpoint issues an
HMAC-protected token; unsafe requests must echo it in a header.

## Token format

```
<base64url(payload)>.<base64url(hmac-sha256)>
```

Payload (pipe-delimited, `core.EncodeCsrfPayload`):

```
<issuedAtUnixSeconds>|<randomBase64Url>|<bindingFingerprint>
```

- `issuedAtUnixSeconds` — integer seconds since epoch.
- `randomBase64Url` — CSPRNG entropy (`TokenEntropyBytes`, default 32).
- `bindingFingerprint` — `core.CsrfBindingFingerprint(source, kind)`,
  a truncated SHA-256 over `ApiPilot.Csrf.Binding.v1|kind|source`.

## Binding resolution

`DefaultBindingResolver` resolves in order — never anonymous:

1. **subject** — authenticated user id (`SubjectExtractor`).
2. **session** — session id (`SessionExtractor`).
3. **preauth** — pre-auth source such as a device fingerprint
   (`PreAuthSource`).

If all resolve to empty, the binding is `null` and CSRF **fails closed**
(bootstrap 403, validation 403).

## Pipeline

1. `GET <BootstrapPath>` (default `/api/csrf`) → issues
   `{ "success": true, "data": { "token": "..." } }` with
   `Cache-Control: no-store`.
2. Unsafe methods (`POST`/`PUT`/`PATCH`/`DELETE` by default) require the
   token in `HeaderName` (default `X-CSRF-Token`).
3. The bootstrap path is **exempt** from validation on every method.

## Validation outcomes → codes

| Outcome | Code |
| --- | --- |
| Header absent/empty | `CSRF_HEADER_MISSING` |
| Bad signature, malformed payload, binding mismatch | `CSRF_TOKEN_INVALID` |
| `issuedAt` older than `TokenLifetimeSeconds` | `CSRF_TOKEN_EXPIRED` |

## Key management

`CsrfKeyRing{ActiveKeyID, Keys}` holds AES-256 key material for the
protector. `httpapi.KeyRingFromEnv()` reads `APIPILOT_CSRF_KEYS`
(JSON: `{"activeKeyId":"k1","keys":{"k1":"<base64>"}}`).
`httpapi.GenerateKeyMaterial()` produces a 32-byte base64 key.

## Go usage

```go
opts := httpapi.DefaultOptions()
opts.Csrf.Enabled = true
opts.Csrf.TokenLifetimeSeconds = 7200
opts.Csrf.ProtectedMethods = []string{"POST", "PUT", "PATCH", "DELETE"}

binding := &httpapi.DefaultBindingResolver{
    SubjectExtractor: func(r *http.Request) string {
        return r.Header.Get("X-User-Id")
    },
}
mw, _ := httpapi.New(opts, nil, binding)
```

## Rotation store (`httpapi.RotationStore`)

Optional server-side store of per-binding rotation markers. A token
whose `issuedAt` predates the binding's marker validates as
`OutcomeRotated` (mapped to `CSRF_TOKEN_INVALID` on the wire).

```go
store := httpapi.NewInMemoryRotationStore()
svc := httpapi.NewCsrfService(protector, binding, 7200, 32).
    WithRotationStore(store)
```

`RotationStore` is an interface (`GetRotationMarker`,
`SetRotationMarker`, `ClearRotationMarker`) � back it with Redis or a
database for multi-instance deployments. `CsrfService.MarkRotated(fp)`
records a marker at the current time.

## Transition listener (`httpapi.CsrfTransitionListener`)

Issues a fresh token on login and clears the rotation marker on logout.
Never authenticates users or writes cookies � the application owns its
session lifecycle.

```go
listener := httpapi.NewCsrfTransitionListener(svc, binding, store)
token, _ := listener.OnLogin(r)          // "" when no binding (fail closed)
listener.OnLogout(r)                     // clears marker for request binding
listener.OnLogoutWithFingerprint(fp)     // explicit fingerprint variant
```

## Endpoint policy resolver (`httpapi.ResolveEndpointPolicy`)

Combines per-route flags into the effective policy with precedence
**Require > Skip > UseGlobal** � later flags never override earlier
higher-precedence ones.

```go
policy := httpapi.ResolveEndpointPolicy(requireCSRF, skipCSRF)
// "require" | "skip" | "useGlobal"
```

## Rotation policy & requirement

`CsrfOptions.RotationPolicy` mirrors `CsrfRotationPolicy` (C#):

- `"onBootstrap"` (default) — bootstrap records a rotation marker; tokens
  issued before the latest bootstrap validate as `rotated`.
- `"onWindow"` — same marker semantics; reserved for window-based rotation.
- `"never"` — no marker is recorded; all unexpired tokens stay valid.

`CsrfOptions.RotationRequirement` mirrors `CsrfRotationRequirement` (C#):

- `"optional"` (default) — store may be omitted; rotation checks are skipped.
- `"required"` — `New()` returns an error when `RotationStore` is nil,
  failing fast at startup.

When a store is configured, `CsrfService.ValidateToken` returns
`OutcomeRotated` for superseded tokens and the middleware maps it to
`CSRF_TOKEN_INVALID` (HTTP 400).
