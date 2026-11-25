"""ApiPilotASGIMiddleware — the ASGI binding for ApiPilot.

Pure ASGI middleware implementing the full ApiPilot pipeline:
correlation → content-negotiation → origin → fetch-metadata → CSRF.
Works with FastAPI, Starlette, Django (ASGI), and any ASGI framework.

Middleware order mirrors the C# pipeline and the TypeScript adapter.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlsplit

from .. import (
    content_negotiation,
    correlation,
    envelope,
    error_codes,
    fetch_metadata,
    pagination,
)
from .. import (
    origin as origin_mod,
)
from . import csrf_extras, observability, ratelimit, responses
from .csrf import (
    CsrfKeyRing,
    CsrfProtector,
    CsrfService,
    DefaultCsrfBindingResolver,
    key_ring_from_env,
)
from .options import SAFE_METHODS, ApiPilotOptions


class ApiPilotASGIMiddleware:
    """ASGI middleware applying the ApiPilot request pipeline.

    Usage (Starlette/FastAPI)::

        app.add_middleware(ApiPilotASGIMiddleware, options=ApiPilotOptions(...))

    Usage (raw ASGI / Django)::

        application = ApiPilotASGIMiddleware(django_asgi_app, options=...)
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

        # CSRF wiring (only when enabled).
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
    # ASGI entry point
    # ------------------------------------------------------------------

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        path = scope.get("path", "")
        headers = _headers_dict(scope)

        # --- 1. Correlation ---
        request_id = await self._resolve_correlation_id(headers, send)
        if request_id is None:
            return  # rejection already sent

        # Wrap send to inject the correlation response header.
        send = _CorrelationSend(send, self.options.correlation, request_id)
        scope["apipilot.request_id"] = request_id

        # --- 1b. Rate limiting ---
        if self._rate_limiter is not None:
            key_fn = self.options.rate_limit.key_extractor or ratelimit.client_key
            allowed, retry_after = self._rate_limiter.allow(key_fn(scope))
            if not allowed:
                self._metrics().record_rate_limited()
                extra = (
                    [(b"retry-after", str(retry_after).encode("ascii"))]
                    if self.options.rate_limit.emit_retry_after and retry_after > 0
                    else None
                )
                await responses.send_error(
                    send,
                    request_id,
                    error_codes.RATE_LIMITED,
                    self.options.rate_limit.message or "Too many requests. Retry later.",
                    extra_headers=extra,
                    json_options=self.options.json,
                )
                return

        # --- 2. Content negotiation ---
        accept = headers.get("accept")
        content_type = headers.get("content-type")
        decision = content_negotiation.evaluate_content_negotiation(
            accept, content_type, method, self.options.content_negotiation
        )
        if decision.status == 406:
            self._metrics().record_validation_failed()
            await responses.send_error(
                send, request_id, error_codes.NOT_ACCEPTABLE,
                "The requested media type is not supported.",
                    json_options=self.options.json,
                )
            return
        if decision.status == 415:
            self._metrics().record_validation_failed()
            message = (
                "A Content-Type header is required for this request."
                if not content_type
                else "The request content type is not supported."
            )
            await responses.send_error(
                send, request_id, error_codes.UNSUPPORTED_MEDIA_TYPE, message,
                    json_options=self.options.json,
                )
            return

        # --- 3. Origin policy (unsafe methods only) ---
        if (
            method not in SAFE_METHODS
            and self.options.origin.enabled
            and not await self._check_origin(headers, send, request_id)
        ):
            return

        # --- 4. Fetch metadata (unsafe methods only) ---
        if (
            method not in SAFE_METHODS
            and self.options.fetch_metadata.profile != "off"
            and not await self._check_fetch_metadata(headers, send, request_id)
        ):
            return

        # --- 5. CSRF bootstrap endpoint ---
        if (
            self._csrf_service is not None
            and method == "GET"
            and path == self.options.csrf.bootstrap_path
        ):
            await self._handle_csrf_bootstrap(scope, send, request_id)
            return

        # --- 6. CSRF validation (unsafe methods only; bootstrap path exempt) ---
        if (
            self._csrf_service is not None
            and method not in SAFE_METHODS
            and path != self.options.csrf.bootstrap_path
            and method in {m.upper() for m in self.options.csrf.protected_methods}
        ) and not await self._check_csrf(scope, headers, send, request_id):
            return

        # --- 7. Pagination (parse + validate; store on scope) ---
        if self.options.pagination_enabled:
            query = _parse_query(scope)
            parsed = pagination.parse_pagination_query(query, self.options.pagination)
            if parsed.errors:
                self._metrics().record_validation_failed()
                await responses.send_validation_error(send, request_id, parsed.errors,
                    json_options=self.options.json,
                )
                return
            scope["apipilot.pagination"] = parsed

        # --- 8. Call the app; map exceptions to envelopes ---
        try:
            await self.app(scope, receive, send)
        except Exception as exc:  # noqa: BLE001 — top-level boundary
            await self._handle_exception(exc, send, request_id)

    # ------------------------------------------------------------------
    # Pipeline stages
    # ------------------------------------------------------------------

    def _metrics(self) -> observability.Metrics:
        return self._metrics_obj

    async def _resolve_correlation_id(
        self, headers: dict[str, str], send: Any
    ) -> str | None:
        """Returns the request id, or None when the policy rejects (response sent)."""
        opts = self.options.correlation
        header_value = headers.get(opts.header_name.lower())
        pattern_matches = (
            header_value is not None
            and opts.validation_pattern.match(header_value) is not None
        )
        decision = correlation.resolve_correlation_id(header_value, opts, pattern_matches)

        if decision.kind == "reject":
            await responses.send_error(
                send, "", error_codes.VALIDATION_ERROR,
                "The correlation ID header is invalid.", status=400,
                    json_options=self.options.json,
                )
            return None

        if decision.kind == "use-incoming" and decision.id is not None:
            return decision.id
        return correlation.generate_guid_v7()

    async def _check_origin(
        self, headers: dict[str, str], send: Any, request_id: str
    ) -> bool:
        """Returns True when the request may proceed."""
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
                await responses.send_error(
                    send, request_id, error_codes.CSRF_ORIGIN_REJECTED,
                    "The request origin could not be verified.",
                    json_options=self.options.json,
                )
                return False
            return True

        allowed = any(
            origin_mod.origin_matches(candidate, allowed_origin, opts.match_mode)
            for allowed_origin in opts.allowed_origins
        )
        if not allowed:
            self._metrics().record_origin_rejected()
            await responses.send_error(
                send, request_id, error_codes.CSRF_ORIGIN_REJECTED,
                "The request origin is not permitted.",
                    json_options=self.options.json,
                )
            return False
        return True

    async def _check_fetch_metadata(
        self, headers: dict[str, str], send: Any, request_id: str
    ) -> bool:
        site = headers.get("sec-fetch-site")
        mode = headers.get("sec-fetch-mode")
        decision = fetch_metadata.evaluate_fetch_metadata(site, mode, self.options.fetch_metadata)
        if decision.decision == "reject":
            self._metrics().record_fetch_metadata_rejected()
            await responses.send_error(
                send, request_id, error_codes.CSRF_ORIGIN_REJECTED,
                "The request fetch metadata is not permitted.",
                    json_options=self.options.json,
                )
            return False
        return True

    async def _handle_csrf_bootstrap(
        self, scope: dict[str, Any], send: Any, request_id: str
    ) -> None:
        """GET bootstrap path → { token } with Cache-Control: no-store."""
        binding = self._csrf_binding.resolve(scope) if self._csrf_binding else None
        if binding is None:
            await responses.send_error(
                send, request_id, error_codes.CSRF_TOKEN_INVALID,
                "The CSRF token could not be issued.",
                    json_options=self.options.json,
                )
            return
        token = self._csrf_service.issue_token(binding.source, binding.kind)
        self._metrics().record_csrf_issued()
        # Rotation policy: onBootstrap/onWindow record a marker so
        # previously issued tokens validate as rotated; never skips.
        if self.options.csrf.rotation_policy != "never":
            csrf_extras.mark_rotated(self._csrf_service, binding.fingerprint)
        body = json.dumps(
            {
                "success": True,
                "data": {"token": token},
                "message": None,
                "meta": envelope.create_meta(request_id).to_dict(),
            },
            separators=(",", ":"),
        ).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"cache-control", b"no-store"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})

    async def _check_csrf(
        self, scope: dict[str, Any], headers: dict[str, str], send: Any, request_id: str
    ) -> bool:
        """Returns True when CSRF validation passes."""
        token = headers.get(self.options.csrf.header_name.lower())
        binding = self._csrf_binding.resolve(scope) if self._csrf_binding else None

        if binding is None:
            self._metrics().record_csrf_rejected()
            await responses.send_error(
                send, request_id, error_codes.CSRF_TOKEN_INVALID,
                "The CSRF token could not be validated.",
                    json_options=self.options.json,
                )
            return False

        result = self._csrf_service.validate_token(token, binding.fingerprint)
        if result.outcome == "valid":
            self._metrics().record_csrf_validated()
            return True
        if result.outcome == "expired":
            self._metrics().record_csrf_expired()
            await responses.send_error(
                send, request_id, error_codes.CSRF_TOKEN_EXPIRED,
                "The CSRF token has expired.",
                    json_options=self.options.json,
                )
            return False
        if result.outcome == "missingToken":
            self._metrics().record_csrf_rejected()
            await responses.send_error(
                send, request_id, error_codes.CSRF_HEADER_MISSING,
                "The CSRF token header is missing.",
                    json_options=self.options.json,
                )
            return False
        self._metrics().record_csrf_rejected()
        await responses.send_error(
            send, request_id, error_codes.CSRF_TOKEN_INVALID,
            "The CSRF token is invalid.",
                    json_options=self.options.json,
                )
        return False

    async def _handle_exception(
        self, exc: BaseException, send: Any, request_id: str
    ) -> None:
        """Maps an exception to an ApiPilot error envelope."""
        # Custom mappers first.
        for mapper in self.options.exception_mappers:
            mapped = mapper(exc)
            if mapped is not None:
                code, message = mapped
                await responses.send_error(send, request_id, code, message, status=500,
                    json_options=self.options.json,
                )
                return

        # FastAPI/Starlette HTTPException → map by status code.
        status_code = getattr(exc, "status_code", None)
        if isinstance(status_code, int) and 400 <= status_code < 500:
            code = (
                error_codes.RESOURCE_NOT_FOUND if status_code == 404
                else error_codes.CONFLICT if status_code == 409
                else error_codes.VALIDATION_ERROR
            )
            message = "The request could not be processed."
            await responses.send_error(send, request_id, code, message, status=status_code,
                    json_options=self.options.json,
                )
            return

        message = (
            str(exc)
            if self.options.exceptions.reveal_exception_message
            else "An unexpected error occurred."
        )
        await responses.send_error(
            send, request_id, error_codes.INTERNAL_ERROR, message, status=500,
                    json_options=self.options.json,
                )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_query(scope: dict[str, Any]) -> dict[str, Any]:
    """Parses the ASGI query string into a {key: value|list} mapping."""
    from urllib.parse import parse_qs

    raw = scope.get("query_string", b"")
    if isinstance(raw, bytes):
        raw = raw.decode("latin-1")
    parsed = parse_qs(raw, keep_blank_values=True)
    # parse_qs returns lists; collapse single-element lists to scalars.
    return {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}


def _headers_dict(scope: dict[str, Any]) -> dict[str, str]:
    """Builds a lowercase header dict from the ASGI scope."""
    result: dict[str, str] = {}
    for name, value in scope.get("headers", []):
        key = name.decode("latin-1").lower()
        # First occurrence wins (mirrors most frameworks).
        if key not in result:
            result[key] = value.decode("latin-1")
    return result


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


class _CorrelationSend:
    """Wraps the ASGI send callable to inject the correlation response header."""

    def __init__(
        self, send: Any, options: correlation.CorrelationOptions, request_id: str
    ) -> None:
        self._send = send
        self._options = options
        self._request_id = request_id
        self._header_injected = False

    async def __call__(self, message: dict[str, Any]) -> None:
        if (
            message.get("type") == "http.response.start"
            and self._options.echo_in_response_header
            and not self._header_injected
        ):
            headers = list(message.get("headers", []))
            headers.append(
                (
                    self._options.header_name.lower().encode("latin-1"),
                    self._request_id.encode("latin-1"),
                )
            )
            message = {**message, "headers": headers}
            self._header_injected = True
        await self._send(message)
