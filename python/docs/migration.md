# Migration

## From another CSRF library

1. Replace token issuance with `GET /api/csrf` bootstrap.
2. Replace token validation with the `X-CSRF-Token` header check —
   the middleware handles it.
3. Configure `DefaultCsrfBindingResolver` with your subject/session
   extractors.
4. Remove old CSRF middleware; keep ApiPilot's pipeline order.

## From a custom envelope

Map your response shape to the ApiPilot envelopes:

- Success → `send_success` / `send_paginated`.
- Error → `send_error` / `send_error_by_code` / `send_validation_error`.
- Keep `meta.requestId` for correlation.

## From Django middleware

`ApiPilotASGIMiddleware` is a pure ASGI middleware — wrap the Django
ASGI handler:

```python
application = ApiPilotASGIMiddleware(application, options=options)
```

## From FastAPI/Starlette

Add the middleware via `app.add_middleware(ApiPilotASGIMiddleware,
options=options)` or wrap the ASGI app directly.
