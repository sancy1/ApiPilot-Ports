"""Consumer CDCT for the ASGI adapter — shared consumer app scenarios.

Mirrors conformance/consumer/README.md: identical routes and assertions
on every port. Run: pytest tests/test_consumer.py
"""

from __future__ import annotations

import base64

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from apipilot.asgi import (
    ApiPilotASGIMiddleware,
    ApiPilotOptions,
    CsrfKeyRing,
    DefaultCsrfBindingResolver,
    generate_key_material,
)

KEY_RING = CsrfKeyRing(
    active_key_id="k1",
    keys={"k1": base64.b64decode(generate_key_material())},
)


def _consumer_app() -> TestClient:
    async def health(request):
        return JSONResponse(
            {
                "success": True,
                "data": {"status": "ok"},
                "message": None,
                "meta": {"requestId": request.scope["apipilot.request_id"]},
            }
        )

    async def items(request):
        parsed = request.scope.get("apipilot.pagination")
        return JSONResponse(
            {
                "success": True,
                "data": {
                    "page": parsed.page_request.page if parsed else None,
                    "pageSize": parsed.page_request.page_size if parsed else None,
                },
                "message": None,
                "meta": {"requestId": request.scope["apipilot.request_id"]},
            }
        )

    async def fail(request):
        return JSONResponse(
            {
                "success": False,
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "Item not found.",
                },
                "meta": {"requestId": request.scope["apipilot.request_id"]},
            },
            status_code=404,
        )

    async def validate(request):
        return JSONResponse(
            {
                "success": False,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Validation failed.",
                    "fields": {"page": ["must be an integer"]},
                },
                "meta": {"requestId": request.scope["apipilot.request_id"]},
            },
            status_code=400,
        )

    async def echo(request):
        body = await request.json()
        return JSONResponse({"success": True, "data": {"echo": body}})

    starlette_app = Starlette(
        routes=[
            Route("/health", health, methods=["GET"]),
            Route("/items", items, methods=["GET"]),
            Route("/fail", fail, methods=["GET"]),
            Route("/validate", validate, methods=["GET"]),
            Route("/echo", echo, methods=["POST"]),
        ]
    )
    opts = ApiPilotOptions()
    opts.csrf.enabled = True
    opts.csrf.rotation_requirement = "optional"
    opts.origin.enabled = True
    opts.origin.allowed_origins = ("https://app.example.com",)
    opts.pagination_enabled = True
    opts.fetch_metadata.profile = "strict"
    binding = DefaultCsrfBindingResolver(
        session_extractor=lambda scope: (
            dict(scope.get("headers", [])).get(b"x-session-id", b"").decode() or None
        ),
    )
    wrapped = ApiPilotASGIMiddleware(
        starlette_app,
        options=opts,
        csrf_key_ring=KEY_RING,
        csrf_binding=binding,
    )
    return TestClient(wrapped)


SESSION = {"x-session-id": "sess-cdct"}


def test_s1_correlation_and_success_envelope() -> None:
    client = _consumer_app()
    res = client.get("/health")
    assert res.status_code == 200
    corr_id = res.headers["x-request-id"]
    assert corr_id
    body = res.json()
    assert body["success"] is True
    assert body["meta"]["requestId"] == corr_id


def test_s2_pagination_context_reaches_handler() -> None:
    client = _consumer_app()
    res = client.get("/items?page=2&pageSize=5")
    assert res.status_code == 200
    body = res.json()
    assert body["data"]["page"] == 2
    assert body["data"]["pageSize"] == 5


def test_s3_invalid_pagination_validation_error() -> None:
    client = _consumer_app()
    res = client.get("/items?page=abc")
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "page" in body["error"]["fields"]


def test_s4_handler_error_not_found_envelope() -> None:
    client = _consumer_app()
    res = client.get("/fail")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "RESOURCE_NOT_FOUND"


def test_s5_disallowed_origin_rejected() -> None:
    client = _consumer_app()
    res = client.post(
        "/echo",
        json={},
        headers={**SESSION, "origin": "https://evil.example"},
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "CSRF_ORIGIN_REJECTED"


def test_s6_csrf_bootstrap_then_protected_post() -> None:
    client = _consumer_app()
    boot = client.get("/api/csrf", headers=SESSION)
    assert boot.status_code == 200
    token = boot.json()["data"]["token"]
    assert token

    no_token = client.post(
        "/echo",
        json={},
        headers={**SESSION, "origin": "https://app.example.com"},
    )
    assert no_token.status_code == 403
    assert no_token.json()["error"]["code"].startswith("CSRF_")

    with_token = client.post(
        "/echo",
        json={},
        headers={
            **SESSION,
            "origin": "https://app.example.com",
            "x-csrf-token": token,
        },
    )
    assert with_token.status_code == 200


def test_s7_fetch_metadata_cross_site_rejected() -> None:
    client = _consumer_app()
    res = client.post(
        "/echo",
        json={},
        headers={
            **SESSION,
            "origin": "https://app.example.com",
            "sec-fetch-site": "cross-site",
        },
    )
    assert res.status_code == 403
