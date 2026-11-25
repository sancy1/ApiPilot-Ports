"""Smoke test for ApiPilotWSGIMiddleware — run: python tests/test_wsgi_smoke.py"""

import base64
import json

from apipilot.asgi import (
    ApiPilotOptions,
    CsrfKeyRing,
    DefaultCsrfBindingResolver,
    generate_key_material,
)
from apipilot.asgi.options import CsrfOptions, OriginPolicyOptions
from apipilot.wsgi import ApiPilotWSGIMiddleware


def app(environ, start_response):
    start_response("200 OK", [("Content-Type", "application/json")])
    return [b'{"ok":true}']


def header(scope, name):
    for k, v in scope["headers"]:
        if k.decode() == name:
            return v.decode()
    return None


def main():
    ring = CsrfKeyRing(
        active_key_id="k1",
        keys={"k1": base64.b64decode(generate_key_material())},
    )
    opts = ApiPilotOptions(
        csrf=CsrfOptions(enabled=True),
        origin=OriginPolicyOptions(
            enabled=True,
            allowed_origins=("http://localhost:5000",),
            require_origin_header=True,
        ),
        pagination_enabled=True,
    )
    binding = DefaultCsrfBindingResolver(
        pre_auth_source=lambda scope: header(scope, "x-client-id"),
    )
    mw = ApiPilotWSGIMiddleware(
        app, options=opts, csrf_key_ring=ring, csrf_binding=binding
    )

    captured = {}

    def sr(status, headers, exc_info=None):
        captured["status"] = status
        captured["headers"] = headers

    env = {
        "REQUEST_METHOD": "GET",
        "PATH_INFO": "/health",
        "QUERY_STRING": "page=1",
        "REMOTE_ADDR": "127.0.0.1",
        "REMOTE_PORT": "1234",
        "HTTP_X_CLIENT_ID": "demo",
        "HTTP_ACCEPT": "application/json",
    }
    body = b"".join(mw(env, sr))
    print("STATUS:", captured["status"])
    print("HEADERS:", captured["headers"])
    print("BODY:", body[:200])
    assert captured["status"].startswith("200")
    assert any(h[0].lower() == "x-request-id" for h in captured["headers"])

    # CSRF bootstrap
    env2 = dict(env, PATH_INFO="/api/csrf", QUERY_STRING="")
    captured.clear()
    body2 = b"".join(mw(env2, sr))
    data = json.loads(body2)
    print("CSRF:", data["data"]["token"][:40], "...")
    assert data["success"] is True
    assert data["data"]["token"].startswith("v1.k1.")
    print("WSGI smoke test PASSED")


if __name__ == "__main__":
    main()
