# CSRF protection

ApiPilot CSRF uses a synchronizer-token pattern: a bootstrap endpoint issues an
encrypted token; unsafe requests must echo it in a header.

## Token format

The wire token is AES-256-GCM encrypted (`CsrfProtector`), mirroring
ASP.NET Data Protection:

```
v1.<keyId>.<iv>.<ciphertext>.<tag>   (each segment base64url)
```

The decrypted payload is pipe-delimited (`encodeCsrfPayload`):

```
<issuedAtUnixSeconds>|<randomBase64Url>|<bindingFingerprint>
```

- `issuedAtUnixSeconds` — integer seconds since epoch.
- `randomBase64Url` — CSPRNG entropy.
- `bindingFingerprint` — `csrfBindingFingerprint(source, kind)`,
  a SHA-256 over `ApiPilot.Csrf.Binding.v1|kind|source`.
- `keyId` selects the key-ring entry that sealed the token, enabling
  rotation without invalidating in-flight tokens.

## Binding resolution

`DefaultCsrfBindingResolver` resolves in order — never anonymous:

1. **subject** — authenticated user id (`subjectExtractor`).
2. **session** — session id (`sessionExtractor`).
3. **preauth** — pre-auth source such as a device fingerprint
   (`preAuthSource`).

If all resolve to empty, the binding is `null` and CSRF **fails closed**
(bootstrap 403, validation 403).

## Pipeline

1. `GET <bootstrapPath>` (default `/api/csrf`) → issues
   `{ "success": true, "data": { "token": "..." } }` with
   `Cache-Control: no-store`.
2. Unsafe methods (`POST`/`PUT`/`PATCH`/`DELETE` by default) require the
   token in `headerName` (default `X-CSRF-Token`).
3. The bootstrap path is **exempt** from validation on every method.

## Validation outcomes → codes

| Outcome | Code |
| --- | --- |
| Header absent/empty | `CSRF_HEADER_MISSING` |
| Bad signature, malformed payload, binding mismatch | `CSRF_TOKEN_INVALID` |
| `issuedAt` older than `tokenLifetimeSeconds` (default 7200) | `CSRF_TOKEN_EXPIRED` |

## Key management

`CsrfKeyRing` holds AES-256 key material for the protector
(`keys: Record<string, Buffer>` — 32-byte keys).
`keyRingFromEnv()` reads `APIPILOT_CSRF_KEYS`
(comma-separated `keyId:base64key` pairs) plus `APIPILOT_CSRF_ACTIVE_KEY`.
`generateKeyMaterial()` produces a 32-byte base64 key.

## TypeScript usage

```ts
app.use(apiPilot({
  csrf: {
    enabled: true,
    tokenLifetimeSeconds: 7200,
    protectedMethods: ["POST", "PUT", "PATCH", "DELETE"],
  },
  csrfBinding: {
    subjectExtractor: (req) => req.user?.id ?? null,
    sessionExtractor: (req) => /* session id or null */,
  },
}));
```

## Rotation store (`RotationStore`)

Optional server-side store of per-binding rotation markers. A token
whose `issuedAtUnixSeconds` predates the binding's marker validates as
`"rotated"` (mapped to `CSRF_TOKEN_INVALID` on the wire).

```ts
import { InMemoryRotationStore } from "@apipilot/node";

const store = new InMemoryRotationStore();
app.use(apiPilot({
  csrf: { enabled: true, rotationStore: store },
  // ...
}));
```

`RotationStore` is an interface (`getRotationMarker`,
`setRotationMarker`, `clearRotationMarker`) � back it with Redis or a
database for multi-instance deployments. `attachRotationStore`,
`markRotated`, and `CsrfTransitionListener` are also exported for
advanced use (login/logout token refresh).

## Transition listener (`CsrfTransitionListener`)

Issues a fresh token on login and clears the rotation marker on logout.
Never authenticates users or writes cookies � the application owns its
session lifecycle.

```ts
const listener = new CsrfTransitionListener(service, bindingResolver, store);
// service/bindingResolver: build via CsrfService + DefaultCsrfBindingResolver
// when wiring CSRF outside the middleware.
const token = listener.onLogin(request);            // null when no binding
const token2 = listener.onLoginWithBinding(src, kind);
listener.onLogout(request);                         // clears marker
listener.onLogoutWithFingerprint(fp);               // explicit fingerprint
```

## Endpoint policy resolver (`resolveEndpointPolicy`)

Combines per-route flags into the effective policy with precedence
**require > skip > useGlobal**.

```ts
import { resolveEndpointPolicy } from "@apipilot/node";

const policy = resolveEndpointPolicy(requireCsrf, skipCsrf);
// "require" | "skip" | "useGlobal"
```

## Rotation policy & requirement

`CsrfOptions.rotationPolicy` mirrors `CsrfRotationPolicy` (C#):

- `"onBootstrap"` (default) — bootstrap records a rotation marker; tokens
  issued before the latest bootstrap validate as `"rotated"`.
- `"onWindow"` — same marker semantics; reserved for window-based rotation.
- `"never"` — no marker is recorded; all unexpired tokens stay valid.

`CsrfOptions.rotationRequirement` mirrors `CsrfRotationRequirement` (C#):

- `"optional"` (default) — store may be omitted; rotation checks are skipped.
- `"required"` — `apiPilot()` throws at registration when
  `rotationStore` is absent, failing fast.

When a store is configured, `CsrfService.validateToken` returns outcome
`"rotated"` for superseded tokens and the hook maps it to
`CSRF_TOKEN_INVALID` (HTTP 400).
