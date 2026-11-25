# Fetch helper (client side)

The C# port ships a browser fetch helper that handles the CSRF bootstrap
and token echo automatically. The Python port is server-side only —
clients should implement the same flow:

## Flow

1. `GET /api/csrf` → `{ "data": { "token": "..." } }`.
2. Store the token; echo it in `X-CSRF-Token` on unsafe requests.
3. On `CSRF_TOKEN_EXPIRED` / `CSRF_TOKEN_INVALID` → re-fetch and retry
   once.

## Python client sketch

```python
import httpx

class CsrfClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.token: str | None = None
        self.client = httpx.Client(base_url=base_url)

    def bootstrap(self) -> None:
        resp = self.client.get("/api/csrf")
        self.token = resp.json()["data"]["token"]

    def request(self, method: str, path: str, **kwargs):
        if method.upper() not in {"GET", "HEAD", "OPTIONS", "TRACE"}:
            kwargs.setdefault("headers", {})["X-CSRF-Token"] = self.token
        return self.client.request(method, path, **kwargs)
```

## Rules

- Token is bound to subject/session — re-bootstrap after login/logout.
- Never log the token; it is a bearer credential for the session.
