# apipilot (Go)

ApiPilot for Go — a behavioral port of the C# ApiPilot library with exact
wire-contract parity. Two packages:

- **`core`** (`github.com/sancy1/ApiPilot-Ports/go/core`) — pure logic: envelopes, error
  codes, pagination, validation keys, origin parsing, fetch metadata, cookie
  profiles, CSRF token format + binding fingerprint, correlation ID, content
  negotiation.
- **`httpapi`** (`github.com/sancy1/ApiPilot-Ports/go/httpapi`) — `net/http` adapter:
  middleware pipeline, CSRF protection (AES-256-GCM), envelope response
  helpers, exception mapping.

## Installation

```sh
go get github.com/sancy1/ApiPilot-Ports/go/core
go get github.com/sancy1/ApiPilot-Ports/go/httpapi
```

## Quick start

```go
package main

import (
	"net/http"

	"github.com/sancy1/ApiPilot-Ports/go/core"
	"github.com/sancy1/ApiPilot-Ports/go/httpapi"
)

func main() {
	opts := httpapi.DefaultOptions()
	mw, err := httpapi.New(opts, nil, nil)
	if err != nil {
		panic(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /items", func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r),
			map[string]string{"hello": "world"}, 0, nil, nil)
	})

	http.ListenAndServe(":8080", mw.Wrap(mux))
}
```

Every response is an ApiPilot envelope:

```json
{
  "success": true,
  "data": { "hello": "world" },
  "message": null,
  "meta": { "requestId": "...", "timestamp": "...", "extra": {} }
}
```

## CSRF protection

Enable CSRF and provide a key ring (or env config):

```go
opts := httpapi.DefaultOptions()
opts.Csrf.Enabled = true

ring := &httpapi.CsrfKeyRing{
	ActiveKeyID: "k1",
	Keys: map[string][]byte{
		"k1": mustDecode("base64-32-byte-key"),
	},
}

binding := &httpapi.DefaultBindingResolver{
	SessionExtractor: func(r *http.Request) string {
		c, _ := r.Cookie("session")
		if c == nil {
			return ""
		}
		return c.Value
	},
}

mw, _ := httpapi.New(opts, ring, binding)
```

Or via environment:

```sh
export APIPILOT_CSRF_KEYS="k1:<base64-32-byte-key>"
export APIPILOT_CSRF_ACTIVE_KEY="k1"
```

- `GET /api/csrf` (bootstrap path, configurable) issues a token —
  `Cache-Control: no-store`.
- Unsafe methods (`POST`/`PUT`/`PATCH`/`DELETE`) require the
  `X-CSRF-Token` header (configurable).
- Tokens are AES-256-GCM protected, bound to subject/session/preauth via a
  SHA-256 fingerprint, and expire after 7200s.

## Middleware order

1. **Correlation** — resolves/generates the request ID, echoes it in the
   response header and `meta.requestId`.
2. **Content negotiation** — `Accept` → 406, `Content-Type` → 415.
3. **Origin policy** — unsafe methods only; `Origin` header with `Referer`
   fallback.
4. **Fetch metadata** — `Sec-Fetch-Site`/`Sec-Fetch-Mode` policy.
5. **CSRF bootstrap** — `GET` on the bootstrap path issues a token.
6. **CSRF validation** — unsafe protected methods.
7. **Pagination** — parses `page`/`pageSize`/`sort`/`direction` + filters;
   validation errors → 400 `VALIDATION_ERROR`. Result available via
   `httpapi.Pagination(r)`.
8. **Exception mapping** — panics are recovered and mapped to error
   envelopes (custom mappers → 4xx `StatusCode()` errors → 500).

## Response helpers

```go
httpapi.SendSuccess(w, requestID, data, status, message, extra)
httpapi.SendPaginated(w, requestID, data, pagination, status, message)
httpapi.SendError(w, requestID, core.ApiErrorCode, message, status, fields, headers)
httpapi.SendErrorByCode(w, requestID, "CODE", message, status)
httpapi.SendValidationError(w, requestID, fields, message)
httpapi.SendRateLimited(w, requestID, retryAfterSeconds)
```

## Context helpers

```go
requestID := httpapi.RequestID(r)          // correlation ID
parsed, ok := httpapi.Pagination(r)        // parsed pagination query
```

## Core modules

| Module | Purpose |
|---|---|
| `errorcodes.go` | 14 standard codes + normalization |
| `envelope.go` | success/paginated/error envelope builders |
| `pagination.go` | page/sort/filter parsing + pagination math |
| `fieldkey.go` | validation field-key normalization |
| `origin.go` | RFC 6454 origin parse + match |
| `fetchmetadata.go` | Sec-Fetch-* policy evaluation |
| `cookieprofile.go` | cookie profile validation |
| `csrfformat.go` | CSRF plaintext payload codec |
| `csrfbinding.go` | binding fingerprint (SHA-256 base64url) |
| `correlation.go` | correlation policy + GUIDv7 |
| `contentnegotiation.go` | Accept/Content-Type evaluation |

## Conformance

The Go core passes all **107 conformance vectors / 251 assertions** — the
same vectors that verify the C#, TypeScript, and Python ports:

```sh
go run ./cmd/conformance
# Conformance: 251 passed, 0 failed
```

Adapter integration tests:

```sh
go test ./httpapi/
# ok  github.com/sancy1/ApiPilot-Ports/go/httpapi
```
