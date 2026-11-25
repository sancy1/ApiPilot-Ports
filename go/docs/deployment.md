# Deployment

## Checklist

- [ ] `APIPILOT_CSRF_KEYS` set in the environment (never in code).
- [ ] `Csrf.Enabled = true` for browser-facing APIs.
- [ ] `Origin.Enabled = true` with explicit `AllowedOrigins`.
- [ ] `FetchMetadata.Profile = strict` for browser-only APIs.
- [ ] `Cookie.Profile = strict` (or `lax` for legacy).
- [ ] `RateLimit.Enabled = true` with `KeyExtractor` for API-key traffic.
- [ ] `PaginationEnabled = true` with `MaxPageSize` tuned.
- [ ] `Correlation.InvalidIdPolicy = reject` for strict environments.
- [ ] HTTPS only — `Secure` cookies and HSTS at the proxy.

## Middleware order

The pipeline is fixed inside `httpapi.Middleware`:

```
correlation → rate limit → content negotiation → origin →
fetch metadata → cookies → CSRF → pagination → handler →
exception mapping
```

Do not add security middleware outside this order — earlier stages
assume correlation ID is resolved.

## Scaling

- Rate limiter and CSRF key ring are per-process. For multi-instance
  deployments see `multi-instance.md`.
- CSRF keys must be identical across instances (shared env secret).

## Health checks

`GET /api/csrf` doubles as a CSRF bootstrap; use a dedicated
`/healthz` outside the middleware for load-balancer probes.
