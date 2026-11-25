"""Response envelope builders — mirrors ApiResponse/ErrorResponse (C#).

Envelope keys are pinned literals — naming policies never apply to them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, TypeAlias

from .error_codes import ApiErrorCode


@dataclass(slots=True)
class ApiMeta:
    """Meta object carried by every envelope."""

    request_id: str
    timestamp: str
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "requestId": self.request_id,
            "timestamp": self.timestamp,
            "extra": self.extra,
        }


@dataclass(slots=True)
class ApiPagination:
    """Pagination block on paginated envelopes. All six fields required."""

    page: int
    page_size: int
    total_items: int
    total_pages: int
    has_next: bool
    has_previous: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "page": self.page,
            "pageSize": self.page_size,
            "totalItems": self.total_items,
            "totalPages": self.total_pages,
            "hasNext": self.has_next,
            "hasPrevious": self.has_previous,
        }


def create_meta(request_id: str, extra: dict[str, Any] | None = None) -> ApiMeta:
    """Creates a meta object with the given request id and current timestamp."""
    return ApiMeta(
        request_id=request_id,
        timestamp=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        extra=extra or {},
    )


def success(data: Any, meta: ApiMeta, message: str | None = None) -> dict[str, Any]:
    """Builds a success envelope: { success, data, message, meta }."""
    return {"success": True, "data": data, "message": message, "meta": meta.to_dict()}


def paginated(
    data: Any, pagination: ApiPagination, meta: ApiMeta, message: str | None = None
) -> dict[str, Any]:
    """Builds a paginated envelope: success envelope + pagination sibling."""
    env = success(data, meta, message)
    env["pagination"] = pagination.to_dict()
    return env


def failure(
    code: ApiErrorCode | str,
    message: str,
    meta: ApiMeta | None = None,
    fields: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """Builds an error envelope: { success: false, error, meta? }.

    ``fields`` is included only when provided (VALIDATION_ERROR only).
    """
    resolved = code if isinstance(code, ApiErrorCode) else ApiErrorCode(code, 500)
    error: dict[str, Any] = {"code": resolved.value, "message": message}
    if fields is not None:
        error["fields"] = fields
    env: dict[str, Any] = {"success": False, "error": error}
    if meta is not None:
        env["meta"] = meta.to_dict()
    return env


def validation_failure(
    fields: dict[str, list[str]],
    meta: ApiMeta,
    message: str | None = None,
) -> dict[str, Any]:
    """Builds a VALIDATION_ERROR envelope with field errors.

    Mirrors ValidationResponseFactory.FromFields: null or whitespace
    message falls back to the C# DefaultMessage.
    """
    if message is None or message.strip() == "":
        message = "One or more values are invalid."
    return failure(ApiErrorCode("VALIDATION_ERROR", 400), message, meta, fields)


Envelope: TypeAlias = dict[str, Any]
