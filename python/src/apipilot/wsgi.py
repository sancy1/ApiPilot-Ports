"""ApiPilotWSGIMiddleware — WSGI binding for ApiPilot.

Pure WSGI middleware implementing the same pipeline as the ASGI adapter:
correlation → rate-limit → content-negotiation → origin → fetch-metadata
→ CSRF → pagination → exception mapping.

Works with Flask, Django (WSGI), Bottle, Pyramid, and any WSGI framework::

    # Flask
    app.wsgi_app = ApiPilotWSGIMiddleware(app.wsgi_app, options=...)

    # Django (WSGI)
    application = ApiPilotWSGIMiddleware(get_wsgi_application(), options=...)

    # Raw WSGI
    application = ApiPilotWSGIMiddleware(my_wsgi_app, options=...)

The middleware builds an ASGI-compatible scope dict from the WSGI
environ, so the same ``DefaultCsrfBindingResolver`` extractors and
``rate_limit.key_extractor`` callables work unchanged — they receive a
dict with ``type``, ``method``, ``path``, ``query_string``, ``headers``
(list of ``(bytes, bytes)``), and ``client``.

Parsed pagination is stored on ``environ["apipilot.pagination"]``
(mirrors ``scope["apipilot.pagination"]`` in the ASGI adapter).
"""

from __future__ import annotations

import json
from http import HTTPStatus
from typing import Any
from urllib.parse import parse_qs, urlsplit

from . import (
    content_negotiation,
    correlation,
    envelope,
    error_codes,
    fetch_metadata,
    pagination,
)
from . import origin as origin_mod
from .asgi import csrf_extras, observability, ratelimit, serialization
from .asgi.csrf import (
    CsrfKeyRing,
    CsrfProtector,
    CsrfService,
    DefaultCsrfBindingResolver,
    key_ring_from_env,
)
from .asgi.options import SAFE_METHODS, ApiPilotOptions


class ApiPilotWSGIMiddleware:
    """WSGI middleware applying the ApiPilot request pipeline.

    Usage::

        application = ApiPilotWSGIMiddleware(app, options=ApiPilotOptions(...))
    """

    def __init__(
        self,
        app: Any,
        options: ApiPilotOptions | None = None,
        csrf_key_ring: CsrfKeyRing | None = None,
        csrf_binding: DefaultCsrfBindingResolver | None = None,
    ) -> None:
        self.app = app
        self.options = options or ApiPilotOptions()
        self._metrics_obj = self.options.metrics or observability.DEFAULT_METRICS

        # CSRF wiring (only when enabled) — identical to the ASGI adapter.
        self._csrf_service: CsrfService | None = None
        self._csrf_binding = csrf_binding
        if self.options.csrf.enabled:
            if (
                self.options.csrf.rotation_requirement == "required"
                and self.options.csrf.rotation_store is None
            ):
                raise ValueError(
                    "csrf.rotation_requirement='required' but no rotation_store configured"
                )
            ring = csrf_key_ring or key_ring_from_env()
            protector = CsrfProtector(ring)
            binding = csrf_binding or DefaultCsrfBindingResolver()
            self._csrf_service = CsrfService(
                protector,
                binding,
                token_lifetime_seconds=self.options.csrf.token_lifetime_seconds,
                token_entropy_bytes=self.options.csrf.token_entropy_bytes,
            )
            if self.options.csrf.rotation_store is not None:
                csrf_extras.attach_rotation_store(
                    self._csrf_service, self.options.csrf.rotation_store
                )
            self._csrf_binding = binding

        # Rate limiter (fixed window, per client key).
        self._rate_limiter: ratelimit.RateLimiter | None = None
        rl = self.options.rate_limit
        if rl.enabled:
            limit = rl.requests_per_window if rl.requests_per_window > 0 else 100
            window = rl.window_seconds if rl.window_seconds > 0 else 60
            self._rate_limiter = ratelimit.RateLimiter(limit, window)

    # ------------------------------------------------------------------
    # WSGI entry point
    # ------------------------------------------------------------------

    def __call__(self, environ: dict[str, Any], start_response: Any) -> Any:
        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO", "")
        scope = _build_scope(environ)
        headers = _headers_dict(scope)

        # --- 1. Correlation ---
        request_id = self._resolve_correlation_id(headers)
        if request_id is None:
            return self._send_error(
                start_response,
                "",
                error_codes.VALIDATION_ERROR,
                "The correlation ID header is invalid.",
                status=400,
            )

        # Wrap start_response to inject the correlation response header.
        start_response = _CorrelationStartResponse(
            start_response, self.options.correlation, request_id
        )

        # --- 1b. Rate limiting ---
        if self._rate_limiter is not None:
            key_fn = self.options.rate_limit.key_extractor or ratelimit.client_key
            allowed, retry_after = self._rate_limiter.allow(key_fn(scope))
            if not allowed:
                self._metrics().record_rate_limited()
                extra = (
                    [("Retry-After", str(retry_after))]
                    if self.options.rate_limit.emit_retry_after and retry_after > 0
                    else None
                )
                return self._send_error(
                    start_response,
                    request_id,
                    error_codes.RATE_LIMITED,
                    self.options.rate_limit.message
                    or "Too many requests. Retry later.",
                    extra_headers=extra,
                )

        # --- 2. Content negotiation ---
        accept = headers.get("accept")
        content_type = headers.get("content-type")
        decision = content_negotiation.evaluate_content_negotiation(
            accept, content_type, method, self.options.content_negotiation
        )
        if decision.status == 406:
            self._metrics().record_validation_failed()
            return self._send_error(
                start_response,
                request_id,
                error_codes.NOT_ACCEPTABLE,
                "The requested media type is not supported.",
            )
        if decision.status == 415:
            self._metrics().record_validation_failed()
            message = (
                "A Content-Type header is required for this request."
                if not content_type
                else "The request content type is not supported."
            )
            return self._send_error(
                start_response,
                request_id,
                error_codes.UNSUPPORTED_MEDIA_TYPE,
                message,
            )

        # --- 3. Origin policy (unsafe methods only) ---
        if (
            method not in SAFE_METHODS
            and self.options.origin.enabled
            and not self._check_origin(headers, start_response, request_id)
        ):
            return []

        # --- 4. Fetch metadata (unsafe methods only) ---
        if (
            method not in SAFE_METHODS
            and self.options.fetch_metadata.profile != "off"
            and not self._check_fetch_metadata(headers, start_response, request_id)
        ):
            return []

        # --- 5. CSRF bootstrap endpoint ---
        if (
            self._csrf_service is not None
            and method == "GET"
            and path == self.options.csrf.bootstrap_path
        ):
            return self._handle_csrf_bootstrap(scope, start_response, request_id)

        # --- 6. CSRF validation (unsafe methods only; bootstrap path exempt) ---
        if (
            self._csrf_service is not None
            and method not in SAFE_METHODS
            and path != self.options.csrf.bootstrap_path
            and method in {m.upper() for m in self.options.csrf.protected_methods}
        ) and not self._check_csrf(scope, headers, start_response, request_id):
            return []

        # --- 7. Pagination (parse + validate; store on environ) ---
        if self.options.pagination_enabled:
            query = _parse_query(environ)
            parsed = pagination.parse_pagination_query(query, self.options.pagination)
            if parsed.errors:
                self._metrics().record_validation_failed()
                return self._send_validation_error(
                    start_response, request_id, parsed.errors
                )
            environ["apipilot.pagination"] = parsed

        # --- 8. Call the app; map exceptions to envelopes ---
        state = {"started": False}

        def _sr(status: str, headers: list, exc_info: Any = None) -> Any:
            state["started"] = True
            return start_response(status, headers, exc_info)

        try:
            result = self.app(environ, _sr)
            return _SafeIterable(result, self, _sr, request_id, state)
        except Exception as exc:
            if state["started"]:
                raise
            return self._handle_exception(exc, start_response, request_id)

    # ------------------------------------------------------------------
    # Pipeline stages
    # ------------------------------------------------------------------

    def _metrics(self) -> observability.Metrics:
        return self._metrics_obj

    def _resolve_correlation_id(self, headers: dict[str, str]) -> str | None:
        """Returns the request id (rejection is sent by the caller)."""
        opts = self.options.correlation
        header_value = headers.get(opts.header_name.lower())
        pattern_matches = (
            header_value is not None
            and opts.validation_pattern.match(header_value) is not None
        )
        decision = correlation.resolve_correlation_id(
            header_value, opts, pattern_matches
        )
        if decision.kind == "reject":
            return None
        if decision.kind == "use-incoming" and decision.id is not None:
            return decision.id
        return correlation.generate_guid_v7()

    def _check_origin(
        self, headers: dict[str, str], start_response: Any, request_id: str
    ) -> bool:
        opts = self.options.origin
        origin_header = headers.get("origin")
        referer = headers.get("referer")

        candidate: str | None = None
        if origin_header:
            candidate = origin_header
        elif opts.allow_referer_fallback and referer:
            candidate = _extract_origin_from_referer(referer)

        if candidate is None:
            if opts.require_origin_header:
                self._metrics().record_origin_rejected()
                self._send_error(
                    start_response,
                    request_id,
                    error_codes.CSRF_ORIGIN_REJECTED,
                    "The request origin could not be verified.",
                )
                return False
            return True

        allowed = any(
            origin_mod.origin_matches(candidate, allowed_origin, opts.match_mode)
            for allowed_origin in opts.allowed_origins
        )
        if not allowed:
            self._metrics().record_origin_rejected()
            self._send_error(
                start_response,
                request_id,
                error_codes.CSRF_ORIGIN_REJECTED,
                "The request origin is not permitted.",
            )
            return False
        return True

    def _check_fetch_metadata(
        self, headers: dict[str, str], start_response: Any, request_id: str
    ) -> bool:
        site = headers.get("sec-fetch-site")
        mode = headers.get("sec-fetch-mode")
        decision = fetch_metadata.evaluate_fetch_metadata(
            site, mode, self.options.fetch_metadata
        )
        if decision.decision == "reject":
            self._metrics().record_fetch_metadata_rejected()
            self._send_error(
                start_response,
                request_id,
                error_codes.CSRF_ORIGIN_REJECTED,
                "The request fetch metadata is not permitted.",
            )
            return False
        return True

    def _handle_csrf_bootstrap(
        self, scope: dict[str, Any], start_response: Any, request_id: str
    ) -> list[bytes]:
        """GET bootstrap path → { token } with Cache-Control: no-store."""
        binding = self._csrf_binding.resolve(scope) if self._csrf_binding else None
        if binding is None:
            return self._send_error(
                start_response,
                request_id,
                error_codes.CSRF_TOKEN_INVALID,
                "The CSRF token could not be issued.",
            )
        token = self._csrf_service.issue_token(binding.source, binding.kind)
        self._metrics().record_csrf_issued()
        if self.options.csrf.rotation_policy != "never":
            csrf_extras.mark_rotated(self._csrf_service, binding.fingerprint)
        payload = {
            "success": True,
            "data": {"token": token},
            "message": None,
            "meta": envelope.create_meta(request_id).to_dict(),
        }
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        start_response(
            "200 OK",
            [
                ("Content-Type", "application/json; charset=utf-8"),
                ("Cache-Control", "no-store"),
                ("Content-Length", str(len(body))),
            ],
        )
        return [body]

    def _check_csrf(
        self,
        scope: dict[str, Any],
        headers: dict[str, str],
        start_response: Any,
        request_id: str,
    ) -> bool:
        token = headers.get(self.options.csrf.header_name.lower())
        binding = self._csrf_binding.resolve(scope) if self._csrf_binding else None

        if binding is None:
            self._metrics().record_csrf_rejected()
            self._send_error(
                start_response,
                request_id,
                error_codes.CSRF_TOKEN_INVALID,
                "The CSRF token could not be validated.",
            )
            return False

        result = self._csrf_service.validate_token(token, binding.fingerprint)
        if result.outcome == "valid":
            self._metrics().record_csrf_validated()
            return True
        if result.outcome == "expired":
            self._metrics().record_csrf_expired()
            self._send_error(
                start_response,
                request_id,
                error_codes.CSRF_TOKEN_EXPIRED,
                "The CSRF token has expired.",
            )
            return False
        if result.outcome == "missingToken":
            self._metrics().record_csrf_rejected()
            self._send_error(
                start_response,
                request_id,
                error_codes.CSRF_HEADER_MISSING,
                "The CSRF token header is missing.",
            )
            return False
        self._metrics().record_csrf_rejected()
        self._send_error(
            start_response,
            request_id,
            error_codes.CSRF_TOKEN_INVALID,
            "The CSRF token is invalid.",
        )
        return False

    def _handle_exception(
        self, exc: BaseException, start_response: Any, request_id: str
    ) -> list[bytes]:
        """Maps an exception to an ApiPilot error envelope."""
        for mapper in self.options.exception_mappers:
            mapped = mapper(exc)
            if mapped is not None:
                code, message = mapped
                return self._send_error(
                    start_response, request_id, code, message, status=500
                )

        status_code = getattr(exc, "status_code", None)
        if isinstance(status_code, int) and 400 <= status_code < 500:
            code = (
                error_codes.RESOURCE_NOT_FOUND
                if status_code == 404
                else error_codes.CONFLICT
                if status_code == 409
                else error_codes.VALIDATION_ERROR
            )
            return self._send_error(
                start_response,
                request_id,
                code,
                "The request could not be processed.",
                status=status_code,
            )

        message = (
            str(exc)
            if self.options.exceptions.reveal_exception_message
            else "An unexpected error occurred."
        )
        return self._send_error(
            start_response,
            request_id,
            error_codes.INTERNAL_ERROR,
            message,
            status=500,
        )

    # ------------------------------------------------------------------
    # WSGI response helpers (mirror asgi/responses.py)
    # ------------------------------------------------------------------

    def _json_bytes(self, payload: dict[str, Any]) -> bytes:
        return serialization.dumps(payload, self.options.json)

    def _send_json(
        self,
        start_response: Any,
        status: int,
        payload: dict[str, Any],
        extra_headers: list[tuple[str, str]] | None = None,
    ) -> list[bytes]:
        body = self._json_bytes(payload)
        headers = [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(body))),
        ]
        if extra_headers:
            headers.extend(extra_headers)
        phrase = (
            HTTPStatus(status).phrase
            if status in HTTPStatus._value2member_map_
            else "OK"
        )
        start_response(f"{status} {phrase}", headers)
        return [body]

    def _send_error(
        self,
        start_response: Any,
        request_id: str,
        code: Any,
        message: str,
        status: int | None = None,
        fields: dict[str, list[str]] | None = None,
        extra_headers: list[tuple[str, str]] | None = None,
    ) -> list[bytes]:
        resolved = code if hasattr(code, "http_status") else error_codes.from_code(code)
        http_status = status if status is not None else resolved.http_status
        meta = envelope.create_meta(request_id)
        return self._send_json(
            start_response,
            http_status,
            envelope.failure(resolved, message, meta, fields),
            extra_headers,
        )

    def _send_validation_error(
        self, start_response: Any, request_id: str, fields: dict[str, list[str]]
    ) -> list[bytes]:
        meta = envelope.create_meta(request_id)
        return self._send_json(
            start_response,
            400,
            envelope.validation_failure(fields, meta),
        )


class _SafeIterable:
    """Wraps the WSGI app's response iterable so exceptions raised during
    iteration are mapped to an ApiPilot error envelope — but only while the
    response has not started (headers not sent)."""

    def __init__(
        self,
        iterable: Any,
        mw: ApiPilotWSGIMiddleware,
        start_response: Any,
        request_id: str,
        state: dict[str, bool],
    ) -> None:
        self._iterable = iterable
        self._mw = mw
        self._start_response = start_response
        self._request_id = request_id
        self._state = state
        self._iterator = iter(iterable)
        self._error_body: list[bytes] | None = None

    def __iter__(self) -> Any:
        return self

    def __next__(self) -> bytes:
        if self._error_body is not None:
            if self._error_body:
                return self._error_body.pop(0)
            raise StopIteration
        try:
            return next(self._iterator)
        except StopIteration:
            self._close()
            raise
        except Exception as exc:
            self._close()
            if self._state["started"]:
                raise
            self._error_body = self._mw._handle_exception(
                exc, self._start_response, self._request_id
            )
            if self._error_body:
                return self._error_body.pop(0)
            raise StopIteration

    def _close(self) -> None:
        close = getattr(self._iterable, "close", None)
        if close is not None:
            try:
                close()
            except Exception:
                pass


class _CorrelationStartResponse:
    """Wraps start_response to inject the correlation response header."""

    def __init__(
        self,
        start_response: Any,
        options: correlation.CorrelationOptions,
        request_id: str,
    ) -> None:
        self._start_response = start_response
        self._options = options
        self._request_id = request_id
        self._injected = False

    def __call__(self, status: str, headers: list, exc_info: Any = None) -> Any:
        if self._options.echo_in_response_header and not self._injected:
            headers = list(headers)
            headers.append((self._options.header_name, self._request_id))
            self._injected = True
        return self._start_response(status, headers, exc_info)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_scope(environ: dict[str, Any]) -> dict[str, Any]:
    """Builds an ASGI-compatible scope dict from a WSGI environ."""
    headers: list[tuple[bytes, bytes]] = []
    for key, value in environ.items():
        if key.startswith("HTTP_"):
            name = key[5:].replace("_", "-").lower()
            headers.append((name.encode("latin-1"), str(value).encode("latin-1")))
    # CONTENT_TYPE / CONTENT_LENGTH are not HTTP_-prefixed in WSGI.
    if "CONTENT_TYPE" in environ:
        headers.append(
            (b"content-type", str(environ["CONTENT_TYPE"]).encode("latin-1"))
        )
    if "CONTENT_LENGTH" in environ:
        headers.append(
            (b"content-length", str(environ["CONTENT_LENGTH"]).encode("latin-1"))
        )

    host = environ.get("REMOTE_ADDR", "")
    try:
        port = int(environ.get("REMOTE_PORT", "0"))
    except (TypeError, ValueError):
        port = 0

    return {
        "type": "http",
        "method": environ.get("REQUEST_METHOD", "GET"),
        "path": environ.get("PATH_INFO", ""),
        "query_string": environ.get("QUERY_STRING", "").encode("latin-1"),
        "headers": headers,
        "client": (host, port),
    }


def _headers_dict(scope: dict[str, Any]) -> dict[str, str]:
    """Builds a lowercase header dict from the scope (first occurrence wins)."""
    result: dict[str, str] = {}
    for name, value in scope.get("headers", []):
        key = name.decode("latin-1").lower()
        if key not in result:
            result[key] = value.decode("latin-1")
    return result


def _parse_query(environ: dict[str, Any]) -> dict[str, Any]:
    """Parses QUERY_STRING into a {key: value|list} mapping."""
    parsed = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=True)
    return {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}


def _extract_origin_from_referer(referer: str) -> str | None:
    """Extracts scheme://host[:port] from a Referer URL."""
    try:
        url = urlsplit(referer)
        if not url.scheme or not url.hostname:
            return None
        host = url.hostname
        if url.port:
            host = f"{host}:{url.port}"
        return f"{url.scheme}://{host}"
    except ValueError:
        return None
