# Migration

## From another CSRF library

1. Replace token issuance with `GET /api/csrf` bootstrap.
2. Replace token validation with the `X-CSRF-Token` header check —
   the middleware handles it.
3. Configure `DefaultBindingResolver` with your subject/session
   extractors.
4. Remove old CSRF middleware; keep ApiPilot's pipeline order.

## From a custom envelope

Map your response shape to the ApiPilot envelopes:

- Success → `SendSuccess` / `SendPaginated`.
- Error → `SendError` / `SendErrorByCode` / `SendValidationError`.
- Keep `meta.requestId` for correlation.

## From Express/Connect middleware

`httpapi.Middleware` is a standard `http.Handler` wrapper:

```go
mux := http.NewServeMux()
mux.HandleFunc("/api/users", handler)
http.ListenAndServe(":8080", mw.Wrap(mux))
```

No framework lock-in — works with any `http.Handler`.

## From FastAPI/Starlette (Python)

See the Python port docs — the ASGI middleware is the equivalent.
