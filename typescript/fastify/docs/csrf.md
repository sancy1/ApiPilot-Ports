# CSRF protection

ApiPilot CSRF uses a double-submit pattern: a bootstrap endpoint issues an
HMAC-protected token; unsafe requests must echo it in a header.

## Token format

```
<base64url(payload)>.<base64url(hmac-sha256)>
```

Payload (pipe-delimited, `encodeCsrfPayload`):

```
<issuedAtUnixSeconds>|<randomBase64Url>|<bindingFingerprint>
```

- `issuedAtUnixSeconds` — integer seconds since epoch.
- `randomBase64Url` — CSPRNG entropy (`tokenEntropyBytes`, default 32).
- `bindingFingerprint` — `csrfBindingFingerprint(source, kind)`,
  a truncated SHA-256 over `ApiPilot.Csrf.Binding.v1|kind|source`.

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
| `issuedAt` older than `tokenLifetimeSeconds` | `CSRF_TOKEN_EXPIRED` |

## Key management

`CsrfKeyRing` holds AES-256 key material for the protector.
`keyRingFromEnv()` reads `APIPILOT_CSRF_KEYS`
(JSON: `{"activeKeyId":"k1","keys":{"k1":"<base64>"}}`).
`generateKeyMaterial()` produces a 32-byte base64 key.

## TypeScript usage

```ts
await app.register(apipilot, {
  csrf: {
    enabled: true,
    tokenLifetimeSeconds: 7200,
    protectedMethods: ["POST", "PUT", "PATCH", "DELETE"],
  },
  csrfBindingResolver: new DefaultCsrfBindingResolver({
    subjectExtractor: (request) => request.user?.id ?? "",
  }),
});
```

## Rotation store (`RotationStore`)

Optional server-side store of per-binding rotation markers. A token
whose `issuedAtUnixSeconds` predates the binding's marker validates as
`"rotated"` (mapped to `CSRF_TOKEN_INVALID` on the wire).

```ts
import {
  InMemoryRotationStore,
  attachRotationStore,
  markRotated,
} from "@apipilot/fastify";

const store = new InMemoryRotationStore();
attachRotationStore(service, store);
markRotated(service, fingerprint);
```

`RotationStore` is an interface (`getRotationMarker`,
`setRotationMarker`, `clearRotationMarker`) � back it with Redis or a
database for multi-instance deployments.

## Transition listener (`CsrfTransitionListener`)

Issues a fresh token on login and clears the rotation marker on logout.
Never authenticates users or writes cookies � the application owns its
session lifecycle.

```ts
const listener = new CsrfTransitionListener(service, bindingResolver, store);
const token = listener.onLogin(request);            // null when no binding
const token2 = listener.onLoginWithBinding(src, kind);
listener.onLogout(request);                         // clears marker
listener.onLogoutWithFingerprint(fp);               // explicit fingerprint
```

## Endpoint policy resolver (`resolveEndpointPolicy`)

Combines per-route flags into the effective policy with precedence
**require > skip > useGlobal**.

```ts
import { resolveEndpointPolicy } from "@apipilot/fastify";

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
- `"required"` — `apipilotPlugin` throws at registration when
  `rotationStore` is absent, failing fast.

When a store is configured, `CsrfService.validateToken` returns outcome
`"rotated"` for superseded tokens and the hook maps it to
`CSRF_TOKEN_INVALID` (HTTP 400).
