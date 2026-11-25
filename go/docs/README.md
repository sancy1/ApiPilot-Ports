# ApiPilot Go documentation

Per-concern documentation for the Go port of ApiPilot
(`github.com/apipilot/go`). The wire contract is identical to the C#
library and the TypeScript/Python ports — see `SPEC.md` in the
repository root for the normative contract.

## Packages

| Package | Purpose |
| --- | --- |
| `core` | Framework-neutral logic: envelopes, error codes, pagination, field keys, origin, fetch metadata, cookie profiles, CSRF format/binding, correlation, content negotiation. |
| `httpapi` | `net/http` adapter: middleware pipeline, CSRF service, responses, rate limiting, diagnostics, OpenAPI error schemas. |
| `cmd/conformance` | Conformance vector runner (251 vectors). |

## Documentation index

### Contracts and responses

| Document | Topic |
| --- | --- |
| `response-contract.md` | Success, paginated, and error envelopes |
| `error-contract.md` | Error codes, statuses, field errors |
| `validation.md` | VALIDATION_ERROR shape and field keys |
| `pagination.md` | Page/pageSize/sort/filter query contract |
| `filtering-sorting.md` | Sort and filter parameter semantics |
| `serialization.md` | JSON naming, enums, dates |
| `content-negotiation.md` | Accept / Content-Type handling |

### Request handling

| Document | Topic |
| --- | --- |
| `correlation.md` | Correlation ID resolution and policies |
| `observability.md` | Logging and diagnostics surface |
| `rate-limiting.md` | Fixed-window rate limiting |
| `multi-instance.md` | Multi-instance deployment notes |

### Security

| Document | Topic |
| --- | --- |
| `csrf.md` | CSRF token format, binding, bootstrap |
| `cookies.md` | Cookie profile validation |
| `origin-policy.md` | Origin/Referer allowlist |
| `fetch-metadata.md` | Sec-Fetch-* header policy |
| `unsafe-methods.md` | Which methods are protected |
| `data-protection.md` | Key ring management (HMAC) |
| `threat-model.md` | Threat model and mitigations |

### Integration

| Document | Topic |
| --- | --- |
| `openapi.md` | OpenAPI error envelope schemas |
| `resilience-integration.md` | Integration with resilience patterns |

### Operations and deployment

| Document | Topic |
| --- | --- |
| `deployment.md` | Deployment checklist |
| `troubleshooting-403.md` | Diagnosing 403 rejections |
| `supply-chain.md` | Dependency and key management |
| `migration.md` | Migrating from other frameworks |

### Conformance

| Document | Topic |
| --- | --- |
| `conformance-vectors.md` | Conformance vector format and runner |
| `port-behavioral-spec.md` | Behavioral spec for ports |

## Quick start

```go
opts := httpapi.DefaultOptions()
opts.Csrf.Enabled = true
opts.Origin.Enabled = true
opts.Origin.AllowedOrigins = []string{"https://app.example.com"}
opts.PaginationEnabled = true

mw, err := httpapi.New(opts, nil, nil) // nil key ring → APIPILOT_CSRF_KEYS env
if err != nil {
    log.Fatal(err)
}

mux := http.NewServeMux()
mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
    httpapi.SendSuccess(w, httpapi.RequestID(r), map[string]string{"pong": "yes"}, 0, nil, nil)
})

http.ListenAndServe(":8080", mw.Wrap(mux))
```

## Testing

```sh
go test ./...                 # unit + integration tests
go run ./cmd/conformance     # 251 conformance vectors
```
