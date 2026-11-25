<!--
filepath: python/README.md
package:  apipilot
since:    v0.1.0
purpose:  ApiPilot for Python — framework-neutral core plus ASGI adapter (FastAPI, Starlette, Django).
-->

# apipilot

ApiPilot for Python. A framework-neutral core implementing the full
ApiPilot wire contract — envelopes, error codes, pagination, validation
field keys, origin policy, fetch-metadata policy, cookie rules, and CSRF
protection — plus an ASGI adapter that works with **FastAPI, Starlette,
and any ASGI-capable framework including Django**.

The core has **zero dependencies**. The ASGI adapter requires
`cryptography` (AES-256-GCM for CSRF token protection).

## Install

```bash
pip install apipilot              # core only
pip install "apipilot[asgi]"      # core + ASGI adapter
```

## Why ASGI and not FastAPI-specific?

ApiPilot is a web-framework integration library — its job is middleware,
headers, cookies, and CSRF. Binding to one framework would repeat the
mistake of picking a single web stack. ASGI is the Python equivalent of
the C# `HttpContext` abstraction: one middleware covers FastAPI,
Starlette, Django (via `asgiref`), Litestar, and Quart. The core package
stays framework-neutral so non-HTTP uses (CLI validation, testing) can
import it without pulling in a web stack.

## Quick start (FastAPI)

```python
from fastapi import FastAPI
from apipilot.asgi import ApiPilotASGIMiddleware, ApiPilotOptions

app = FastAPI()
app.add_middleware(ApiPilotASGIMiddleware, options=ApiPilotOptions())
```

## Quick start (Starlette / raw ASGI / Django)

```python
# Starlette
app.add_middleware(ApiPilotASGIMiddleware, options=ApiPilotOptions())

# Raw ASGI / Django (ASGI deployment — uvicorn/daphne/hypercorn)
application = ApiPilotASGIMiddleware(django_asgi_app, options=ApiPilotOptions())
```

Runnable samples: `samples/fastapi_app.py`, `samples/starlette_app.py`,
`samples/django_app.py` (Django via `get_asgi_application()`).

## WSGI frameworks (Flask, Django-WSGI, Bottle, Pyramid)

`apipilot.wsgi.ApiPilotWSGIMiddleware` implements the same pipeline for
WSGI apps — same options, same CSRF key ring, same binding resolvers
(the middleware builds an ASGI-compatible scope from the WSGI environ):

```python
from apipilot.wsgi import ApiPilotWSGIMiddleware

# Flask
app.wsgi_app = ApiPilotWSGIMiddleware(app.wsgi_app, options=ApiPilotOptions())

# Django (WSGI deployment — gunicorn)
application = ApiPilotWSGIMiddleware(get_wsgi_application(), options=ApiPilotOptions())
```

Requires `pip install "apipilot[wsgi]"` (cryptography for CSRF). Parsed
pagination is available at `environ["apipilot.pagination"]`.

## CSRF protection

```python
from apipilot.asgi import ApiPilotOptions, CsrfKeyRing, generate_key_material
import base64

options = ApiPilotOptions()
options.csrf.enabled = True

key_ring = CsrfKeyRing(
    active_key_id="k1",
    keys={"k1": base64.b64decode(generate_key_material())},
)
```

Or via environment (multi-instance contract):

```bash
export APIPILOT_CSRF_KEYS="k1:<base64-32-byte-key>"
export APIPILOT_CSRF_ACTIVE_KEY="k1"
```

When enabled the middleware:

- registers `GET /api/csrf` returning `{ "token": "…" }` with
  `Cache-Control: no-store`
- rejects unsafe methods missing `X-CSRF-Token` with
  `CSRF_HEADER_MISSING` (403)
- validates signature, expiry, and binding fingerprint, returning
  `CSRF_TOKEN_INVALID` / `CSRF_TOKEN_EXPIRED` on failure

Binding resolution order: subject extractor → session extractor →
pre-auth source (all configurable on `DefaultCsrfBindingResolver`).

## Middleware order

Mirrors the C# pipeline:

1. **Correlation** — `X-Request-Id` in/out, GUIDv7 generation, invalid-ID policy
2. **Content negotiation** — 406/415 on Accept/Content-Type
3. **Origin policy** — RFC 6454 matching on unsafe methods
4. **Fetch metadata** — Sec-Fetch-Site/Mode evaluation
5. **CSRF** — token validation on protected methods
6. **Exception mapping** — exceptions → ApiPilot error envelopes

## Core modules

| Module | Mirrors (C#) |
|---|---|
| `error_codes` | `ApiErrorCode` — 14 standard codes |
| `envelope` | `ApiResponse`/`ErrorResponse` builders |
| `pagination` | `PaginationOptions`, `PageRequest`, query parsing |
| `field_key` | `FieldKeyNormalizer` |
| `origin` | `OriginValidator` |
| `fetch_metadata` | `FetchMetadataEvaluator` |
| `cookie_profile` | `CookieProfileOptionsValidator` |
| `csrf_format` | `CsrfTokenFormat` (pipe-delimited payload) |
| `csrf_binding` | `CsrfBindingProvider.Fingerprint` |
| `correlation` | `CorrelationMiddleware` logic |
| `content_negotiation` | `ApiPilotContentNegotiationMiddleware` |

## Conformance

`apipilot` passes all **107 ApiPilot conformance vectors (251 assertions)**
— the same vectors the C# and TypeScript ports run. See
`tests/conformance_runner.py`.

## License

Apache-2.0 — same as ApiPilot.
