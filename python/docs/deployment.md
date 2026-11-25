# Deployment

## Checklist

- [ ] `APIPILOT_CSRF_KEYS` set in the environment (never in code).
- [ ] `csrf.enabled = True` for browser-facing APIs.
- [ ] `origin.enabled = True` with explicit `allowed_origins`.
- [ ] `fetch_metadata.profile = strict` for browser-only APIs.
- [ ] `cookies.profile = strict` (or `lax` for legacy).
- [ ] `rate_limit.enabled = True` with `key_extractor` for API-key traffic.
- [ ] `pagination_enabled = True` with `max_page_size` tuned.
- [ ] `correlation.invalid_id_policy = reject` for strict environments.
- [ ] HTTPS only — `Secure` cookies and HSTS at the proxy.

## Middleware order

The pipeline is fixed inside `ApiPilotASGIMiddleware`:

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
