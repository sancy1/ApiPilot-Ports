# Deployment

## Checklist

- [ ] `APIPILOT_CSRF_KEYS` set in the environment (never in code).
- [ ] `csrf.enabled = true` for browser-facing APIs.
- [ ] `origin.enabled = true` with explicit `allowedOrigins`.
- [ ] `fetchMetadata.profile = "strict"` for browser-only APIs.
- [ ] `cookies.profile = "strict"` (or `"lax"` for legacy).
- [ ] `rateLimit.enabled = true` with `keyExtractor` for API-key traffic.
- [ ] `paginationEnabled = true` with `maxPageSize` tuned.
- [ ] `correlation.invalidIdPolicy = "reject"` for strict environments.
- [ ] HTTPS only — `Secure` cookies and HSTS at the proxy.

## Middleware order

The pipeline is fixed inside the Fastify plugin's hooks:

```
correlation → rate limit → content negotiation → origin →
fetch metadata → cookies → CSRF → pagination → handler →
exception mapping
```

Do not add security hooks outside this order — earlier stages
assume correlation ID is resolved.

## Scaling

- Rate limiter and CSRF key ring are per-process. For multi-instance
  deployments see `multi-instance.md`.
- CSRF keys must be identical across instances (shared env secret).

## Health checks

`GET /api/csrf` doubles as a CSRF bootstrap; use a dedicated
`/healthz` outside the plugin for load-balancer probes.
