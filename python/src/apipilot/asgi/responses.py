"""ASGI response helpers — produce ApiPilot envelopes on the wire.

Mirrors results.ts (TypeScript adapter) and Results/* (C#). These are
pure ASGI send helpers: they write status + headers + JSON body directly
to the ASGI send channel.
"""

from __future__ import annotations

from typing import Any

from .. import envelope
from ..error_codes import ApiErrorCode, from_code
from . import serialization
from .options import JsonOptions


def _json_bytes(payload: dict[str, Any], options: JsonOptions | None = None) -> bytes:
    return serialization.dumps(payload, options)


async def _send_json(
    send: Any,
    status: int,
    payload: dict[str, Any],
    extra_headers: list[tuple[bytes, bytes]] | None = None,
    json_options: JsonOptions | None = None,
) -> None:
    body = _json_bytes(payload, json_options)
    headers = [
        (b"content-type", b"application/json; charset=utf-8"),
        (b"content-length", str(len(body)).encode("ascii")),
    ]
    if extra_headers:
        headers.extend(extra_headers)
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


async def send_success(
    send: Any,
    request_id: str,
    data: Any,
    status: int = 200,
    message: str | None = None,
    extra: dict[str, Any] | None = None,
    json_options: JsonOptions | None = None,
) -> None:
    """Sends a success envelope."""
    if json_options is not None:
        data = serialization.transform_data(data, json_options)
        if extra is not None:
            extra = serialization.transform_data(extra, json_options)
    meta = envelope.create_meta(request_id, extra)
    await _send_json(
        send,
        status,
        envelope.success(data, meta, message),
        json_options=json_options,
    )


async def send_paginated(
    send: Any,
    request_id: str,
    data: Any,
    pagination: envelope.ApiPagination,
    status: int = 200,
    message: str | None = None,
    json_options: JsonOptions | None = None,
) -> None:
    """Sends a paginated envelope."""
    if json_options is not None:
        data = serialization.transform_data(data, json_options)
    meta = envelope.create_meta(request_id)
    await _send_json(
        send,
        status,
        envelope.paginated(data, pagination, meta, message),
        json_options=json_options,
    )


async def send_error(
    send: Any,
    request_id: str,
    code: ApiErrorCode | str,
    message: str,
    status: int | None = None,
    fields: dict[str, list[str]] | None = None,
    extra_headers: list[tuple[bytes, bytes]] | None = None,
    json_options: JsonOptions | None = None,
) -> None:
    """Sends an error envelope for a standard or custom code."""
    resolved = code if isinstance(code, ApiErrorCode) else from_code(code)
    http_status = status if status is not None else resolved.http_status
    meta = envelope.create_meta(request_id)
    await _send_json(
        send,
        http_status,
        envelope.failure(resolved, message, meta, fields),
        extra_headers,
        json_options=json_options,
    )


async def send_validation_error(
    send: Any,
    request_id: str,
    fields: dict[str, list[str]],
    message: str | None = None,
    json_options: JsonOptions | None = None,
) -> None:
    """Sends a VALIDATION_ERROR envelope with field errors."""
    meta = envelope.create_meta(request_id)
    await _send_json(
        send,
        400,
        envelope.validation_failure(fields, meta, message),
        json_options=json_options,
    )


async def send_rate_limited(
    send: Any,
    request_id: str,
    retry_after_seconds: int | None = None,
    json_options: JsonOptions | None = None,
) -> None:
    """Sends a RATE_LIMITED envelope with optional Retry-After."""
    extra = (
        [(b"retry-after", str(retry_after_seconds).encode("ascii"))]
        if retry_after_seconds
        else None
    )
    await send_error(
        send,
        request_id,
        ApiErrorCode("RATE_LIMITED", 429),
        "Too many requests.",
        extra_headers=extra,
        json_options=json_options,
    )
