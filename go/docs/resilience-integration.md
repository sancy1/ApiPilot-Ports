# Resilience integration

ApiPilot is a contract layer, not a resilience library. Integrate with
your platform's resilience primitives.

## Timeouts and retries

- Apply at the HTTP client / reverse proxy layer, not in ApiPilot.
- ApiPilot responses are synchronous; no async retry logic inside.

## Circuit breakers

- Wrap upstream calls in your handler; ApiPilot only shapes the
  response envelope.
- Map upstream failures to `INTERNAL_ERROR` or a custom code via
  `SendErrorByCode`.

## Rate limiting vs. resilience

ApiPilot's rate limiter is a fixed-window per-key guard for abusive
traffic — not a resilience pattern. For adaptive limiting use a
service mesh or gateway.

## Health checks

Expose `/healthz` outside the ApiPilot middleware so load balancers
can probe without CSRF/origin requirements.
