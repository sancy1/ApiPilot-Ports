# Supply chain

## Dependencies

The Python port has **zero runtime dependencies** — `apipilot` uses only
the standard library. Install with `pip install apipilot`.

## Key management

- CSRF keys come from `APIPILOT_CSRF_KEYS` (JSON env var) or an explicit
  `CsrfKeyRing`. Never commit keys.
- `generate_key_material()` produces 32-byte AES-256 keys; store them in a
  secrets manager (Vault, AWS Secrets Manager, Kubernetes secrets).
- Rotate via multi-key `CsrfKeyRing` — see `multi-instance.md`.

## Conformance

`python -m apipilot.conformance` runs 251 language-neutral vectors from
`../conformance/vectors/` — the same fixtures the C# and Go ports run.
Run it in CI to prove wire-contract parity.

## Reproducible builds

```sh
pytest tests/ -q
python -m apipilot.conformance
```
