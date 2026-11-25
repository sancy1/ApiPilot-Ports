# ApiPilot Fastify documentation

Per-concern documentation for the TypeScript port of ApiPilot
(`@apipilot/fastify` + `@apipilot/core`). The wire contract is identical
to the C# library and the Go/Python ports — see `SPEC.md` in the
repository root for the normative contract.

## Packages

| Package | Purpose |
| --- | --- |
| `@apipilot/core` | Framework-neutral logic: envelopes, error codes, pagination, field keys, origin, fetch metadata, cookie profiles, CSRF format/binding, correlation, content negotiation. |
| `@apipilot/fastify` | Fastify plugin: hooks pipeline, CSRF service, responses, rate limiting, diagnostics, OpenAPI error schemas. |

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

```ts
import Fastify from "fastify";
import apipilot from "@apipilot/fastify";

const app = Fastify();
await app.register(apipilot, {
  csrf: { enabled: true },
  origin: { enabled: true, allowedOrigins: ["https://app.example.com"] },
  paginationEnabled: true,
});
```

## Testing

```sh
npm test                 # unit + integration tests
node scripts/run-conformance.mjs   # 251 conformance vectors
```
