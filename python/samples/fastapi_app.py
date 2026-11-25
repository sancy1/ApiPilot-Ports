"""Runnable ApiPilot Python sample — FastAPI + ASGI middleware.

Demonstrates the full pipeline: correlation IDs, content negotiation,
origin policy, CSRF (bootstrap + validation), rate limiting, and the
standard error envelope.

Run::

    cd python && pip install -e ".[asgi]" fastapi uvicorn
    python samples/fastapi_app.py

Then::

    curl http://localhost:8000/health
    curl http://localhost:8000/api/csrf                       # bootstrap → { token }
    curl -X POST http://localhost:8000/api/items \
         -H "X-Client-Id: demo" -H "X-CSRF-Token: <token>" \
         -H "Origin: http://localhost:8000" -H "Content-Type: application/json" \
         -d '{"name": "widget"}'
"""

from __future__ import annotations

import base64

from apipilot.asgi import (
    ApiPilotASGIMiddleware,
    ApiPilotOptions,
    CsrfKeyRing,
    DefaultCsrfBindingResolver,
    generate_key_material,
)
from apipilot.asgi.options import (
    CsrfOptions,
    OriginPolicyOptions,
    RateLimitOptions,
)


def _header(scope: dict, name: bytes) -> str | None:
    for key, value in scope.get("headers", []):
        if key.lower() == name:
            return value.decode("latin-1")
    return None


def build_app():
    from fastapi import FastAPI

    app = FastAPI(title="ApiPilot Sample")

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/api/items", status_code=201)
    async def create_item(payload: dict):
        return {"created": payload}

    # --- ApiPilot options -------------------------------------------------
    options = ApiPilotOptions(
        csrf=CsrfOptions(enabled=True),
        origin=OriginPolicyOptions(
            enabled=True,
            allowed_origins=("http://localhost:8000",),
            require_origin_header=True,
        ),
        rate_limit=RateLimitOptions(
            enabled=True,
            requests_per_window=60,
            window_seconds=60,
        ),
    )

    # Demo key ring — production should load from APIPILOT_CSRF_KEYS /
    # APIPILOT_CSRF_ACTIVE_KEY via key_ring_from_env().
    key_ring = CsrfKeyRing(
        active_key_id="k1",
        keys={"k1": base64.b64decode(generate_key_material())},
    )

    # Binding: pre-auth source from a client header (demo only — real apps
    # should resolve subject/session bindings from auth state).
    binding = DefaultCsrfBindingResolver(
        pre_auth_source=lambda scope: _header(scope, b"x-client-id"),
    )

    app.add_middleware(
        ApiPilotASGIMiddleware,
        options=options,
        csrf_key_ring=key_ring,
        csrf_binding=binding,
    )
    return app


app = build_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
