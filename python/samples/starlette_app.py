"""Runnable ApiPilot Python sample — Starlette (pure ASGI, no FastAPI).

Proves the ASGI adapter works with any ASGI framework, not just FastAPI.

Run::

    cd python && pip install -e ".[asgi]" uvicorn
    python samples/starlette_app.py

Then::

    curl http://localhost:8001/health
    curl http://localhost:8001/api/csrf -H "X-Client-Id: demo"
    curl -X POST http://localhost:8001/api/items \
         -H "X-Client-Id: demo" -H "X-CSRF-Token: <token>" \
         -H "Origin: http://localhost:8001" -H "Content-Type: application/json" \
         -d '{"name": "widget"}'
"""

from __future__ import annotations

import base64
import json

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


async def health(scope, receive, send):
    body = json.dumps({"status": "ok"}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": body})


async def create_item(scope, receive, send):
    # Drain the request body.
    chunks = []
    while True:
        msg = await receive()
        chunks.append(msg.get("body", b""))
        if not msg.get("more_body"):
            break
    payload = json.loads(b"".join(chunks) or b"{}")
    body = json.dumps({"created": payload}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 201,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": body})


async def router(scope, receive, send):
    path = scope.get("path", "")
    if scope["type"] == "http" and scope["method"] == "GET" and path == "/health":
        await health(scope, receive, send)
    elif scope["type"] == "http" and scope["method"] == "POST" and path == "/api/items":
        await create_item(scope, receive, send)
    else:
        body = json.dumps({"detail": "not found"}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 404,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": body})


def build_app():
    options = ApiPilotOptions(
        csrf=CsrfOptions(enabled=True),
        origin=OriginPolicyOptions(
            enabled=True,
            allowed_origins=("http://localhost:8001",),
            require_origin_header=True,
        ),
        rate_limit=RateLimitOptions(
            enabled=True,
            requests_per_window=60,
            window_seconds=60,
        ),
        pagination_enabled=True,
    )

    key_ring = CsrfKeyRing(
        active_key_id="k1",
        keys={"k1": base64.b64decode(generate_key_material())},
    )
    binding = DefaultCsrfBindingResolver(
        pre_auth_source=lambda scope: _header(scope, b"x-client-id"),
    )

    return ApiPilotASGIMiddleware(
        router,
        options=options,
        csrf_key_ring=key_ring,
        csrf_binding=binding,
    )


app = build_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8001)
