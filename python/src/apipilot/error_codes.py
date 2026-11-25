"""ApiErrorCode — the fourteen standard ApiPilot error codes.

Mirrors ``ApiPilot.Core.Errors.ApiErrorCode`` (C#). Codes are immutable
string values; ``ApiErrorCode.from_code`` trims and uppercases input
(invariant). Custom codes are permitted but fall through to HTTP 500
unless the application supplies its own mapper.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True, slots=True)
class ApiErrorCode:
    """An ApiPilot error code with its default HTTP status."""

    value: str
    http_status: int

    def __str__(self) -> str:
        return self.value


# The fourteen standard codes, in SPEC.md table order.
VALIDATION_ERROR: Final = ApiErrorCode("VALIDATION_ERROR", 400)
AUTHENTICATION_REQUIRED: Final = ApiErrorCode("AUTHENTICATION_REQUIRED", 401)
FORBIDDEN: Final = ApiErrorCode("FORBIDDEN", 403)
CSRF_HEADER_MISSING: Final = ApiErrorCode("CSRF_HEADER_MISSING", 403)
CSRF_TOKEN_INVALID: Final = ApiErrorCode("CSRF_TOKEN_INVALID", 403)
CSRF_TOKEN_EXPIRED: Final = ApiErrorCode("CSRF_TOKEN_EXPIRED", 403)
CSRF_ORIGIN_REJECTED: Final = ApiErrorCode("CSRF_ORIGIN_REJECTED", 403)
RESOURCE_NOT_FOUND: Final = ApiErrorCode("RESOURCE_NOT_FOUND", 404)
CONFLICT: Final = ApiErrorCode("CONFLICT", 409)
RATE_LIMITED: Final = ApiErrorCode("RATE_LIMITED", 429)
INTERNAL_ERROR: Final = ApiErrorCode("INTERNAL_ERROR", 500)
CONFIGURATION_ERROR: Final = ApiErrorCode("CONFIGURATION_ERROR", 500)
NOT_ACCEPTABLE: Final = ApiErrorCode("NOT_ACCEPTABLE", 406)
UNSUPPORTED_MEDIA_TYPE: Final = ApiErrorCode("UNSUPPORTED_MEDIA_TYPE", 415)

_ALL_STANDARD: Final[tuple[ApiErrorCode, ...]] = (
    VALIDATION_ERROR,
    AUTHENTICATION_REQUIRED,
    FORBIDDEN,
    CSRF_HEADER_MISSING,
    CSRF_TOKEN_INVALID,
    CSRF_TOKEN_EXPIRED,
    CSRF_ORIGIN_REJECTED,
    RESOURCE_NOT_FOUND,
    CONFLICT,
    RATE_LIMITED,
    INTERNAL_ERROR,
    CONFIGURATION_ERROR,
    NOT_ACCEPTABLE,
    UNSUPPORTED_MEDIA_TYPE,
)

_REGISTRY: Final[dict[str, ApiErrorCode]] = {c.value: c for c in _ALL_STANDARD}

#: All standard codes in SPEC.md order.
ALL_STANDARD: Final[tuple[ApiErrorCode, ...]] = _ALL_STANDARD


def from_code(raw: str) -> ApiErrorCode:
    """Normalizes a raw string into an ApiErrorCode.

    Trims and uppercases (case-insensitive invariant). Returns the
    canonical instance for standard codes; a new instance for custom
    codes (HTTP 500).

    Raises:
        ValueError: when ``raw`` is None, empty, or whitespace.
    """
    if raw is None:
        raise ValueError("from_code requires a non-None string.")
    normalized = raw.strip().upper()
    if not normalized:
        raise ValueError("from_code requires a non-empty string.")
    return _REGISTRY.get(normalized, ApiErrorCode(normalized, 500))


def try_from_code(raw: str | None) -> ApiErrorCode | None:
    """Returns the canonical code for a wire string, or None when invalid."""
    if raw is None:
        return None
    try:
        return from_code(raw)
    except ValueError:
        return None
