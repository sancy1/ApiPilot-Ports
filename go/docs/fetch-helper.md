# Fetch helper (client side)

The C# port ships a browser fetch helper that handles the CSRF bootstrap
and token echo automatically. The Go port is server-side only — clients
should implement the same flow:

## Flow

1. `GET /api/csrf` → `{ "data": { "token": "..." } }`.
2. Store the token; echo it in `X-CSRF-Token` on unsafe requests.
3. On `CSRF_TOKEN_EXPIRED` / `CSRF_TOKEN_INVALID` → re-fetch and retry
   once.

## Go client sketch

```go
type CsrfClient struct {
    baseURL string
    token   string
    hc      *http.Client
}

func (c *CsrfClient) Bootstrap(ctx context.Context) error {
    resp, err := c.hc.Get(c.baseURL + "/api/csrf")
    // parse { data: { token } }
}

func (c *CsrfClient) Do(req *http.Request) (*http.Response, error) {
    if req.Method != "GET" && req.Method != "HEAD" {
        req.Header.Set("X-CSRF-Token", c.token)
    }
    return c.hc.Do(req)
}
```

## Rules

- Token is bound to subject/session — re-bootstrap after login/logout.
- Never log the token; it is a bearer credential for the session.
