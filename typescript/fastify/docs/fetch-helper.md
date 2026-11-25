# Fetch helper (client side)

The C# port ships a browser fetch helper that handles the CSRF bootstrap
and token echo automatically. The TypeScript port is server-side only —
clients should implement the same flow:

## Flow

1. `GET /api/csrf` → `{ "data": { "token": "..." } }`.
2. Store the token; echo it in `X-CSRF-Token` on unsafe requests.
3. On `CSRF_TOKEN_EXPIRED` / `CSRF_TOKEN_INVALID` → re-fetch and retry
   once.

## TypeScript client sketch

```ts
class CsrfClient {
  private token: string | null = null;

  constructor(private baseUrl: string) {}

  async bootstrap(): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/api/csrf`);
    const body = await resp.json();
    this.token = body.data.token;
  }

  async request(method: string, path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(method.toUpperCase())) {
      headers.set("X-CSRF-Token", this.token!);
    }
    return fetch(`${this.baseUrl}${path}`, { ...init, method, headers });
  }
}
```

## Rules

- Token is bound to subject/session — re-bootstrap after login/logout.
- Never log the token; it is a bearer credential for the session.
