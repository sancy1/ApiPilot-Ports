"""ASGI adapter integration tests — Starlette TestClient against ApiPilotASGIMiddleware."""

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
from apipilot.asgi import options as opt

KEY = generate_key_material()
KEY_RING = CsrfKeyRing(active_key_id="k1", keys={"k1": base64.b64decode(KEY)})


def _binding() -> DefaultCsrfBindingResolver:
    return DefaultCsrfBindingResolver(
        subject_extractor=lambda scope: (
            dict(scope.get("headers", [])).get(b"x-test-subject", b"").decode() or None
        ),
    )


def _app(options: ApiPilotOptions | None = None, csrf: bool = False) -> TestClient:
    async def ping(request):
        return JSONResponse({"pong": True})

    async def echo(request):
        return JSONResponse({"ok": True})

    async def fail(request):
        return JSONResponse({"error": "x"}, status_code=404)

    starlette_app = Starlette(
        routes=[
            Route("/ping", ping),
            Route("/echo", echo, methods=["POST"]),
            Route("/fail", fail),
        ]
    )
    opts = options or ApiPilotOptions()
    if csrf:
        opts.csrf.enabled = True
    wrapped = ApiPilotASGIMiddleware(
        starlette_app, options=opts, csrf_key_ring=KEY_RING, csrf_binding=_binding()
    )
    return TestClient(wrapped)


def test_success_passthrough() -> None:
    client = _app()
    res = client.get("/ping")
    assert res.status_code == 200
    assert res.headers["x-request-id"]
    body = res.json()
    assert (
        body["pong"] is True
    )  # app response untouched (not enveloped — app owns body)


def test_correlation_incoming_echoed() -> None:
    client = _app()
    res = client.get("/ping", headers={"x-request-id": "req-abc-123"})
    assert res.headers["x-request-id"] == "req-abc-123"


def test_content_negotiation_406() -> None:
    client = _app()
    res = client.get("/ping", headers={"accept": "text/html"})
    assert res.status_code == 406
    assert res.json()["error"]["code"] == "NOT_ACCEPTABLE"


def test_content_negotiation_415() -> None:
    client = _app()
    res = client.post("/echo")
    assert res.status_code == 415
    assert res.json()["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"


def test_origin_rejects_disallowed() -> None:
    options = ApiPilotOptions()
    options.origin = opt.OriginPolicyOptions(
        enabled=True, allowed_origins=("https://app.example.com",)
    )
    client = _app(options)
    res = client.post(
        "/echo",
        headers={
            "origin": "https://evil.example.com",
            "content-type": "application/json",
        },
        json={},
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "CSRF_ORIGIN_REJECTED"


def test_origin_allows_matching() -> None:
    options = ApiPilotOptions()
    options.origin = opt.OriginPolicyOptions(
        enabled=True, allowed_origins=("https://app.example.com",)
    )
    client = _app(options)
    res = client.post(
        "/echo",
        headers={
            "origin": "https://app.example.com",
            "content-type": "application/json",
        },
        json={},
    )
    assert res.status_code == 200


def test_csrf_bootstrap_and_roundtrip() -> None:
    client = _app(csrf=True)
    boot = client.get("/api/csrf", headers={"x-test-subject": "user-1"})
    assert boot.status_code == 200
    assert boot.headers["cache-control"] == "no-store"
    token = boot.json()["data"]["token"]
    assert token

    # POST without token → CSRF_HEADER_MISSING
    no_token = client.post(
        "/echo",
        headers={"x-test-subject": "user-1", "content-type": "application/json"},
        json={},
    )
    assert no_token.status_code == 403
    assert no_token.json()["error"]["code"] == "CSRF_HEADER_MISSING"

    # POST with token → 200
    with_token = client.post(
        "/echo",
        headers={
            "x-test-subject": "user-1",
            "content-type": "application/json",
            "x-csrf-token": token,
        },
        json={},
    )
    assert with_token.status_code == 200


def test_csrf_wrong_subject_rejected() -> None:
    client = _app(csrf=True)
    boot = client.get("/api/csrf", headers={"x-test-subject": "user-1"})
    token = boot.json()["data"]["token"]

    res = client.post(
        "/echo",
        headers={
            "x-test-subject": "user-2",
            "content-type": "application/json",
            "x-csrf-token": token,
        },
        json={},
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "CSRF_TOKEN_INVALID"


def test_unhandled_exception_safe_message() -> None:
    # Raw ASGI app — no framework error middleware — so ApiPilot owns the
    # exception boundary and emits the INTERNAL_ERROR envelope.
    async def boom_app(scope, receive, send):
        raise RuntimeError("secret internals")

    wrapped = ApiPilotASGIMiddleware(boom_app, options=ApiPilotOptions())
    client = TestClient(wrapped)
    res = client.get("/boom")
    assert res.status_code == 500
    body = res.json()
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert body["error"]["message"] == "An unexpected error occurred."


# ---------------------------------------------------------------------------
# Expanded integration scenarios (mirroring C# integration tests)
# ---------------------------------------------------------------------------


def _options(**overrides) -> ApiPilotOptions:
    opts = ApiPilotOptions()
    for key, value in overrides.items():
        setattr(opts, key, value)
    return opts


def test_correlation_reject_policy() -> None:
    from apipilot import correlation as corr

    options = _options()
    options.correlation = corr.CorrelationOptions(invalid_id_policy="reject")
    client = _app(options)
    res = client.get("/ping", headers={"x-request-id": "bad id with spaces!"})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_correlation_generated_is_guidv7() -> None:
    client = _app()
    res = client.get("/ping")
    request_id = res.headers["x-request-id"]
    assert len(request_id) == 36
    assert request_id[14] == "7"


def test_correlation_custom_header_name() -> None:
    from apipilot import correlation as corr

    options = _options()
    options.correlation = corr.CorrelationOptions(header_name="X-Correlation-Id")
    client = _app(options)
    res = client.get("/ping", headers={"x-correlation-id": "corr-12345"})
    assert res.headers["x-correlation-id"] == "corr-12345"
    assert "x-request-id" not in res.headers


def test_origin_missing_header_rejected() -> None:
    options = _options()
    options.origin = opt.OriginPolicyOptions(
        enabled=True,
        allowed_origins=("https://app.example.com",),
        require_origin_header=True,
        allow_referer_fallback=True,
    )
    client = _app(options)
    res = client.post(
        "/echo",
        headers={"content-type": "application/json"},
        json={},
    )
    assert res.status_code == 403


def test_origin_referer_fallback() -> None:
    options = _options()
    options.origin = opt.OriginPolicyOptions(
        enabled=True,
        allowed_origins=("https://app.example.com",),
        require_origin_header=True,
        allow_referer_fallback=True,
    )
    client = _app(options)
    res = client.post(
        "/echo",
        headers={
            "content-type": "application/json",
            "referer": "https://app.example.com/some/page",
        },
        json={},
    )
    assert res.status_code == 200


def test_origin_safe_method_skips() -> None:
    options = _options()
    options.origin = opt.OriginPolicyOptions(
        enabled=True,
        allowed_origins=("https://app.example.com",),
        require_origin_header=True,
    )
    client = _app(options)
    res = client.get("/ping", headers={"origin": "https://evil.com"})
    assert res.status_code == 200


def test_fetch_metadata_strict_rejects_cross_site() -> None:
    from apipilot import fetch_metadata as fm

    options = _options()
    options.fetch_metadata = fm.FetchMetadataOptions(profile="strict")
    client = _app(options)
    res = client.post(
        "/echo",
        headers={
            "content-type": "application/json",
            "sec-fetch-site": "cross-site",
        },
        json={},
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "CSRF_ORIGIN_REJECTED"


def test_fetch_metadata_strict_allows_same_origin() -> None:
    from apipilot import fetch_metadata as fm

    options = _options()
    options.fetch_metadata = fm.FetchMetadataOptions(profile="strict")
    client = _app(options)
    res = client.post(
        "/echo",
        headers={
            "content-type": "application/json",
            "sec-fetch-site": "same-origin",
            "sec-fetch-mode": "cors",
        },
        json={},
    )
    assert res.status_code == 200


def test_csrf_safe_method_skips() -> None:
    client = _app(csrf=True)
    res = client.get("/ping")
    assert res.status_code == 200


def test_csrf_tampered_token_rejected() -> None:
    client = _app(csrf=True)
    boot = client.get("/api/csrf", headers={"x-test-subject": "user-1"})
    token = boot.json()["data"]["token"]
    tampered = token[:-5] + "X" + token[-4:]
    res = client.post(
        "/echo",
        headers={
            "x-test-subject": "user-1",
            "content-type": "application/json",
            "x-csrf-token": tampered,
        },
        json={},
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "CSRF_TOKEN_INVALID"


def test_csrf_bootstrap_path_exempt_on_post() -> None:
    client = _app(csrf=True)
    res = client.post(
        "/api/csrf",
        headers={"content-type": "application/json"},
        json={},
    )
    # Starlette returns 405 for POST on a GET-only route — never 403.
    assert res.status_code != 403


def test_csrf_custom_header_name() -> None:
    opts = ApiPilotOptions()
    opts.csrf.enabled = True
    opts.csrf.header_name = "X-XSRF-TOKEN"

    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    async def echo(request):
        return JSONResponse({"ok": True})

    starlette_app = Starlette(routes=[Route("/echo", echo, methods=["POST"])])
    wrapped = ApiPilotASGIMiddleware(
        starlette_app, options=opts, csrf_key_ring=KEY_RING, csrf_binding=_binding()
    )
    client = TestClient(wrapped)

    boot = client.get("/api/csrf", headers={"x-test-subject": "user-1"})
    token = boot.json()["data"]["token"]
    res = client.post(
        "/echo",
        headers={
            "x-test-subject": "user-1",
            "content-type": "application/json",
            "x-xsrf-token": token,
        },
        json={},
    )
    assert res.status_code == 200


def test_csrf_custom_protected_methods() -> None:
    opts = ApiPilotOptions()
    opts.csrf.enabled = True
    opts.csrf.protected_methods = ("DELETE",)

    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    async def echo(request):
        return JSONResponse({"ok": True})

    async def delete_item(request):
        return JSONResponse({"ok": True})

    starlette_app = Starlette(
        routes=[
            Route("/echo", echo, methods=["POST"]),
            Route("/item/{item_id}", delete_item, methods=["DELETE"]),
        ]
    )
    wrapped = ApiPilotASGIMiddleware(
        starlette_app, options=opts, csrf_key_ring=KEY_RING, csrf_binding=_binding()
    )
    client = TestClient(wrapped)

    post = client.post(
        "/echo",
        headers={"content-type": "application/json"},
        json={},
    )
    assert post.status_code == 200

    delete = client.delete("/item/1")
    assert delete.status_code == 403


def test_csrf_preauth_binding() -> None:
    opts = ApiPilotOptions()
    opts.csrf.enabled = True

    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    async def echo(request):
        return JSONResponse({"ok": True})

    starlette_app = Starlette(routes=[Route("/echo", echo, methods=["POST"])])
    binding = DefaultCsrfBindingResolver(pre_auth_source=lambda scope: "preauth-fixed")
    wrapped = ApiPilotASGIMiddleware(
        starlette_app, options=opts, csrf_key_ring=KEY_RING, csrf_binding=binding
    )
    client = TestClient(wrapped)

    boot = client.get("/api/csrf")
    token = boot.json()["data"]["token"]
    res = client.post(
        "/echo",
        headers={"content-type": "application/json", "x-csrf-token": token},
        json={},
    )
    assert res.status_code == 200


def test_csrf_no_binding_rejects_bootstrap() -> None:
    opts = ApiPilotOptions()
    opts.csrf.enabled = True

    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    async def echo(request):
        return JSONResponse({"ok": True})

    starlette_app = Starlette(routes=[Route("/echo", echo, methods=["POST"])])
    wrapped = ApiPilotASGIMiddleware(
        starlette_app,
        options=opts,
        csrf_key_ring=KEY_RING,
        csrf_binding=DefaultCsrfBindingResolver(),  # no extractors
    )
    client = TestClient(wrapped)
    res = client.get("/api/csrf")
    assert res.status_code == 403


def test_exception_custom_mapper() -> None:
    async def boom_app(scope, receive, send):
        raise RuntimeError("quota exceeded")

    options = ApiPilotOptions()
    options.exception_mappers = (
        lambda exc: (
            ("QUOTA_EXCEEDED", "Quota exceeded.")
            if str(exc) == "quota exceeded"
            else None
        ),
    )
    wrapped = ApiPilotASGIMiddleware(boom_app, options=options)
    client = TestClient(wrapped)
    res = client.get("/boom")
    assert res.status_code == 500
    assert res.json()["error"]["code"] == "QUOTA_EXCEEDED"


def test_exception_reveal_message() -> None:
    async def boom_app(scope, receive, send):
        raise RuntimeError("sensitive detail")

    options = ApiPilotOptions()
    options.exceptions.reveal_exception_message = True
    wrapped = ApiPilotASGIMiddleware(boom_app, options=options)
    client = TestClient(wrapped)
    res = client.get("/boom")
    assert res.json()["error"]["message"] == "sensitive detail"


def test_exception_http_status_mapping() -> None:
    from starlette.exceptions import HTTPException

    async def boom_app(scope, receive, send):
        raise HTTPException(status_code=404, detail="gone")

    wrapped = ApiPilotASGIMiddleware(boom_app, options=ApiPilotOptions())
    client = TestClient(wrapped)
    res = client.get("/boom")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "RESOURCE_NOT_FOUND"


def test_correlation_id_in_csrf_error_envelope() -> None:
    client = _app(csrf=True)
    res = client.post(
        "/echo",
        headers={
            "content-type": "application/json",
            "x-request-id": "corr-fixed-123",
        },
        json={},
    )
    assert res.status_code == 403
    assert res.json()["meta"]["requestId"] == "corr-fixed-123"

# ---------------------------------------------------------------------------
# Rate limiting + pagination (Phase B)
# ---------------------------------------------------------------------------


def test_rate_limit_allows_up_to_limit() -> None:
    opts = ApiPilotOptions()
    opts.rate_limit.enabled = True
    opts.rate_limit.requests_per_window = 2
    opts.rate_limit.window_seconds = 60
    client = _app(opts)
    for _ in range(2):
        res = client.get("/ping")
        assert res.status_code == 200
    res = client.get("/ping")
    assert res.status_code == 429
    assert res.headers["retry-after"]
    body = res.json()
    assert body["error"]["code"] == "RATE_LIMITED"
    assert body["error"]["message"] == "Too many requests. Retry later."


def test_rate_limit_disabled_by_default() -> None:
    client = _app()
    for _ in range(10):
        assert client.get("/ping").status_code == 200


def test_rate_limit_custom_key_extractor() -> None:
    opts = ApiPilotOptions()
    opts.rate_limit.enabled = True
    opts.rate_limit.requests_per_window = 1
    opts.rate_limit.window_seconds = 60
    opts.rate_limit.key_extractor = lambda scope: dict(scope.get("headers", [])).get(
        b"x-user", b""
    ).decode() or "anon"
    client = _app(opts)
    for user in ("alice", "bob"):
        res = client.get("/ping", headers={"x-user": user})
        assert res.status_code == 200
    res = client.get("/ping", headers={"x-user": "alice"})
    assert res.status_code == 429


def test_pagination_parses_and_stores_on_scope() -> None:
    opts = ApiPilotOptions()
    opts.pagination_enabled = True

    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    async def items(request):
        parsed = request.scope.get("apipilot.pagination")
        assert parsed is not None
        assert parsed.page_request.page == 2
        assert parsed.page_request.page_size == 10
        assert parsed.sort.field == "name"
        assert parsed.sort.direction == "desc"
        assert parsed.filter.parameters["status"] == "active"
        return JSONResponse({"ok": True})

    starlette_app = Starlette(routes=[Route("/items", items)])
    wrapped = ApiPilotASGIMiddleware(starlette_app, options=opts)
    client = TestClient(wrapped)
    res = client.get("/items?page=2&pageSize=10&sort=name&direction=desc&status=active")
    assert res.status_code == 200


def test_pagination_invalid_page_size() -> None:
    opts = ApiPilotOptions()
    opts.pagination_enabled = True

    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    async def items(request):
        return JSONResponse({"ok": True})

    starlette_app = Starlette(routes=[Route("/items", items)])
    wrapped = ApiPilotASGIMiddleware(starlette_app, options=opts)
    client = TestClient(wrapped)
    res = client.get("/items?pageSize=500")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"
    assert res.json()["error"]["message"] == "One or more values are invalid."

# ---------------------------------------------------------------------------
# Diagnostics (Phase B)
# ---------------------------------------------------------------------------


def test_diagnostics_csrf_no_binding() -> None:
    from apipilot.asgi import diagnostics as diag

    opts = ApiPilotOptions()
    opts.csrf.enabled = True
    diags = diag.diagnostics(opts, DefaultCsrfBindingResolver())
    assert any(d.code == "csrf-no-binding" and d.level == "warning" for d in diags)


def test_diagnostics_csrf_binding_configured() -> None:
    from apipilot.asgi import diagnostics as diag

    opts = ApiPilotOptions()
    opts.csrf.enabled = True
    binding = DefaultCsrfBindingResolver(subject_extractor=lambda scope: "u")
    diags = diag.diagnostics(opts, binding)
    assert not any(d.code == "csrf-no-binding" for d in diags)


def test_diagnostics_origin_empty_allowlist() -> None:
    from apipilot.asgi import diagnostics as diag

    opts = ApiPilotOptions()
    opts.origin.enabled = True
    diags = diag.diagnostics(opts)
    assert any(d.code == "origin-empty-allowlist" for d in diags)


def test_diagnostics_clean_config() -> None:
    from apipilot.asgi import diagnostics as diag

    assert diag.diagnostics(ApiPilotOptions()) == []

# ---------------------------------------------------------------------------
# OpenAPI error schemas (Phase B)
# ---------------------------------------------------------------------------


def test_openapi_error_schemas_shape() -> None:
    from apipilot.asgi import openapi

    schemas = openapi.error_schemas()
    assert len(schemas) == 3
    env = schemas[openapi.ERROR_ENVELOPE_SCHEMA_NAME]
    assert env["properties"]["success"]["enum"] == [False]
    assert set(env["required"]) == {"success", "error"}
    obj = schemas[openapi.ERROR_OBJECT_SCHEMA_NAME]
    assert "fields" in obj["properties"]
    fields = schemas[openapi.ERROR_FIELDS_SCHEMA_NAME]
    assert fields["additionalProperties"]["type"] == "array"


def test_cookie_profile_validation_fails_fast():
    import pytest

    from apipilot.asgi.options import ApiPilotOptions, CookieProfilesOptions
    from apipilot.cookie_profile import CookieProfile
    bad = CookieProfile(name='auth', secure=False, http_only=True, same_site='none', path='/', domain=None)
    with pytest.raises(ValueError, match='Invalid cookie profile'):
        ApiPilotOptions(cookies=CookieProfilesOptions(auth=bad))
