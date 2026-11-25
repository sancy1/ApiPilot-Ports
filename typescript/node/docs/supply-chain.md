# Supply chain

## Dependencies

`@apipilot/core` and `@apipilot/node` have **zero external runtime
dependencies** — the adapter uses only `node:http`/`node:crypto`
builtins plus `@apipilot/core`.

## Key management

- CSRF keys come from `APIPILOT_CSRF_KEYS` + `APIPILOT_CSRF_ACTIVE_KEY`
  (env vars) or an explicit `CsrfKeyRing`. Never commit keys.
- `generateKeyMaterial()` produces 32-byte AES-256 keys; store them in a
  secrets manager (Vault, AWS Secrets Manager, Kubernetes secrets).
- Rotate via multi-key `CsrfKeyRing` — see `multi-instance.md`.

## Conformance

`npm test` runs the unit suite plus the adapter conformance suite
(`test/conformance-adapter.mjs`); `npm run conformance` additionally runs
the 251 language-neutral vectors from `../core/conformance/vectors/` —
the same fixtures the C#, Go, and Python ports run. Run it in CI to
prove wire-contract parity.

## Reproducible builds

```sh
npm run build && npm test
npm run conformance
```
