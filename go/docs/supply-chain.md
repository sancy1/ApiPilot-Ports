# Supply chain

## Dependencies

The Go port has **zero runtime dependencies** — `core` and `httpapi`
use only the standard library. `go.mod` requires Go 1.22+.

## Key management

- CSRF keys come from `APIPILOT_CSRF_KEYS` (JSON env var) or an explicit
  `CsrfKeyRing`. Never commit keys.
- `GenerateKeyMaterial()` produces 32-byte AES-256 keys; store them in a
  secrets manager (Vault, AWS Secrets Manager, Kubernetes secrets).
- Rotate via multi-key `CsrfKeyRing` — see `multi-instance.md`.

## Conformance

`cmd/conformance` runs 251 language-neutral vectors from
`../conformance/vectors/` — the same fixtures the C# and TypeScript
ports run. Run it in CI to prove wire-contract parity.

## Reproducible builds

```sh
go build ./... && go test ./...
go run ./cmd/conformance
```
