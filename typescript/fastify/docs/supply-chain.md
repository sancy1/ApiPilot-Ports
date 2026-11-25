# Supply chain

## Dependencies

`@apipilot/core` has **zero runtime dependencies**. `@apipilot/fastify`
depends only on `fastify` and `@apipilot/core`.

## Key management

- CSRF keys come from `APIPILOT_CSRF_KEYS` (JSON env var) or an explicit
  `CsrfKeyRing`. Never commit keys.
- `generateKeyMaterial()` produces 32-byte AES-256 keys; store them in a
  secrets manager (Vault, AWS Secrets Manager, Kubernetes secrets).
- Rotate via multi-key `CsrfKeyRing` — see `multi-instance.md`.

## Conformance

`node scripts/run-conformance.mjs` runs 251 language-neutral vectors from
`../conformance/vectors/` — the same fixtures the C# and Go ports run.
Run it in CI to prove wire-contract parity.

## Reproducible builds

```sh
npm run build && npm test
node scripts/run-conformance.mjs
```
