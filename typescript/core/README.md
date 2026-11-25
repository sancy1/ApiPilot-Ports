<!--
filepath: typescript/core/README.md
package:  @apipilot/core
since:    v0.1.0
purpose:  Framework-neutral ApiPilot core for TypeScript — envelopes, error codes, pagination, validation keys, origin, fetch-metadata, cookie rules, CSRF format and binding.
-->

# @apipilot/core

The framework-neutral core of [ApiPilot](https://github.com/sancy1/ApiPilot)
for TypeScript. This package contains **pure logic only** — no HTTP
framework imports, no Node-specific APIs beyond `node:crypto` for the
CSRF binding fingerprint and GUIDv7 generator.

It is the TypeScript equivalent of `ApiPilot.Core` + the pure cores of
`ApiPilot.Security` in the C# library. Framework adapters
(`@apipilot/fastify`, `@apipilot/express`, …) build on this package.

## What it provides

| Module | Mirrors (C#) | Contents |
|---|---|---|
| `error-codes` | `ApiErrorCode` | 14 standard codes, `from()` normalization, HTTP status map |
| `envelope` | `ApiResponse`/`ErrorResponse` builders | success / paginated / error envelopes, `ApiMeta`, `ApiPagination` |
| `pagination` | `ApiPilot.Core.Pagination` | options, `PageRequest`, query parsing, pagination math, sort/filter requests |
| `field-key` | `FieldKeyNormalizer` | validation field-name normalization + transform resolver |
| `origin` | `OriginValidator` | RFC 6454 parse + Exact/AnyPortSameHost matching |
| `fetch-metadata` | `FetchMetadataEvaluator` | Off/Compat/Strict evaluation (identical decisions for Compat/Strict) |
| `cookie-profile` | `CookieProfileOptionsValidator` | startup-validation rules, `__Host-`/`__Secure-` prefixes |
| `csrf-format` | `CsrfTokenFormat` | `issuedAt\|random\|binding` payload codec (no cryptography) |
| `csrf-binding` | `CsrfBindingProvider.Fingerprint` | deterministic SHA-256 base64url binding fingerprint |
| `correlation` | `CorrelationMiddleware` logic | invalid-ID policies + GUIDv7 generator |
| `content-negotiation` | `ApiPilotContentNegotiationMiddleware` cores | Accept/Content-Type evaluators |

## Zero dependencies

Runtime dependencies: **none**. The only imports are `node:crypto`
(SHA-256 for binding fingerprints, CSPRNG for GUIDv7) and standard
JavaScript built-ins.

## Conformance

This package is verified against the ApiPilot conformance vectors —
language-neutral JSON fixtures in `conformance/vectors/` that pin the
observable wire behavior shared by every port.

```bash
npm install
npm run build
npm run conformance   # 107 vectors / 251 assertions
```

A green conformance run means this package reproduces the C# wire
contract exactly for every behavior the vectors cover.

## Relationship to the C# library

- `SPEC.md` in the ApiPilot repository is the normative wire contract.
- `docs/port-behavioral-spec.md` is the consolidated behavioral checklist.
- `docs/conformance-vectors.md` defines the vector format.
- Envelope keys (`success`, `data`, `error`, `meta`, `pagination`, …)
  are pinned literals — naming policies never apply to them.

## License

Apache-2.0 — same as ApiPilot.
