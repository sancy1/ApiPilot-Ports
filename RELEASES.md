# Releases

## v0.1.2 — 2026-11-28

Security-audit release. Fixes one fail-open default divergence and a set of
documentation inaccuracies found during a cross-port security review. No
cryptographic primitives, wire formats, or public API signatures changed.

### Fixed

- **Origin policy default aligned across ports (TypeScript).**
  `requireOriginHeader` now defaults to `true` in `@apipilot/node`,
  `@apipilot/fastify` (and therefore `@apipilot/hono` / `@apipilot/next`,
  which share the node options resolver). This matches the Go and Python
  ports and the published documentation. Previously the TypeScript ports
  allowed unsafe requests carrying neither `Origin` nor `Referer` when
  `origin.enabled` was true; they are now rejected with
  `CSRF_ORIGIN_REJECTED` (403), restoring the documented fail-closed
  posture. Consumers relying on the old permissive default should either
  send `Origin`/`Referer` (all browsers do on unsafe methods) or set
  `requireOriginHeader: false` explicitly.
- **CSRF documentation corrected.** `csrf.md` in the Go, Python, and
  Fastify doc sets described an HMAC "double-submit" token format that did
  not match the implementation. All ports now document the actual
  AES-256-GCM synchronizer-token wire format
  (`v1.<keyId>.<iv>.<ciphertext>.<tag>`) and the correct binding
  fingerprint description.
- **Threat-model tables corrected.** The CSRF mitigation row now describes
  the AES-256-GCM encrypted synchronizer token (was "double-submit HMAC"),
  and the log-injection row now reflects that `invalidIdPolicy` /
  `InvalidIdPolicy` / `invalid_id_policy` chooses between replace, reject,
  and use-as-is handling of invalid correlation IDs.
- **Go JSON serialization documented.** `serialization.md` now notes that
  HTML escaping is disabled (`SetEscapeHTML(false)`) and warns that JSON
  embedded in HTML must be escaped by the application or protected by a
  strict CSP.

### Verification

- TypeScript: 213 tests pass across `@apipilot/core`, `node`, `fastify`,
  `hono`, `next`.
- Python: 161 tests pass; ruff clean.
- Go: `go build`, `go vet`, `go test` clean; conformance vectors pass.
- Consumer-driven contract check (`scripts/cdct.py`) and generated-docs
  freshness check (`scripts/check_docs.py`) pass.
