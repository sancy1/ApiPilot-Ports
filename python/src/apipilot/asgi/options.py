"""ApiPilot ASGI adapter options — mirrors ApiPilotOptions (C#).

All defaults match the C# library and the TypeScript adapter.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .. import (
    content_negotiation,
    cookie_profile,
    correlation,
    fetch_metadata,
    pagination,
)

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


@dataclass(slots=True)
class OriginPolicyOptions:
    """Origin policy configuration."""

    enabled: bool = False
    allowed_origins: tuple[str, ...] = ()
    match_mode: str = "exact"  # "exact" | "anyPortSameHost" | "sameSite"
    require_origin_header: bool = True
    allow_referer_fallback: bool = True


@dataclass(slots=True)
class CsrfOptions:
    """CSRF protection configuration."""

    enabled: bool = False
    header_name: str = "X-CSRF-Token"
    bootstrap_path: str = "/api/csrf"
    token_lifetime_seconds: int = 7200
    token_entropy_bytes: int = 32
    protected_methods: tuple[str, ...] = ("POST", "PUT", "PATCH", "DELETE")
    #: "onBootstrap" (default) | "onWindow" | "never" — when bootstrap
    #: records a rotation marker. Mirrors CsrfRotationPolicy (C#).
    rotation_policy: str = "onBootstrap"
    #: "optional" (default) | "required" — "required" raises at startup
    #: when no rotation_store is configured. Mirrors
    #: CsrfRotationRequirement (C#).
    rotation_requirement: str = "optional"
    #: Optional RotationStore (csrf_extras.RotationStore protocol).
    rotation_store: Any = None


@dataclass(slots=True)
class CookieProfilesOptions:
    """Cookie profile overrides (auth/session/csrf)."""

    auth: cookie_profile.CookieProfile = field(
        default_factory=lambda: cookie_profile.DEFAULT_COOKIE_PROFILES["auth"]
    )
    session: cookie_profile.CookieProfile = field(
        default_factory=lambda: cookie_profile.DEFAULT_COOKIE_PROFILES["session"]
    )
    csrf: cookie_profile.CookieProfile = field(
        default_factory=lambda: cookie_profile.DEFAULT_COOKIE_PROFILES["csrf"]
    )


@dataclass(slots=True)
class ExceptionOptions:
    """Exception mapping configuration."""

    reveal_exception_message: bool = False
    reveal_exception_details: bool = False


@dataclass(slots=True)
class RateLimitOptions:
    """Rate limiting configuration (fixed-window, per client key).

    Mirrors ApiPilotRateLimitOptions (Option D): rejections emit a
    RATE_LIMITED envelope with an optional Retry-After header.
    """

    enabled: bool = False
    requests_per_window: int = 100
    window_seconds: int = 60
    message: str = "Too many requests. Retry later."
    emit_retry_after: bool = True
    #: Key extractor: scope → key. None → client host ("anonymous" fallback).
    key_extractor: Callable[[dict], str] | None = None


@dataclass(slots=True)
class JsonOptions:
    """JSON serialization configuration.

    Mirrors ApiPilotJsonOptions (C#): naming policies, enum/date modes,
    indentation, null handling. Envelope keys are always pinned camelCase —
    these options apply to the data payload only.
    """

    camel_case: bool = True
    indent: bool | None = None
    #: "string" (default) or "number".
    enum_mode: str = "string"
    #: "iso8601" (default) or "unixSeconds".
    date_mode: str = "iso8601"
    #: "camelCase" (default), "snake_case", or "passthrough".
    property_naming_policy: str | None = None
    #: Dictionary key policy; defaults to property_naming_policy.
    dictionary_key_policy: str | None = None
    #: Omit null values from maps and lists.
    ignore_nulls: bool = False


@dataclass(slots=True)
class ApiPilotOptions:
    """Top-level ApiPilot configuration for the ASGI adapter."""

    correlation: correlation.CorrelationOptions = field(
        default_factory=correlation.CorrelationOptions
    )
    content_negotiation: content_negotiation.ContentNegotiationOptions = field(
        default_factory=content_negotiation.ContentNegotiationOptions
    )
    origin: OriginPolicyOptions = field(default_factory=OriginPolicyOptions)
    fetch_metadata: fetch_metadata.FetchMetadataOptions = field(
        default_factory=fetch_metadata.FetchMetadataOptions
    )
    csrf: CsrfOptions = field(default_factory=CsrfOptions)
    cookies: CookieProfilesOptions = field(default_factory=CookieProfilesOptions)
    exceptions: ExceptionOptions = field(default_factory=ExceptionOptions)
    rate_limit: RateLimitOptions = field(default_factory=RateLimitOptions)
    json: JsonOptions = field(default_factory=JsonOptions)
    #: Pagination query parsing (mirrors PaginationEndpointFilter).
    pagination: pagination.PaginationOptions = field(
        default_factory=pagination.PaginationOptions
    )
    #: When true, pagination query params are parsed/validated on every request.
    pagination_enabled: bool = False

    #: Custom exception mapper: exception → (code, message) or None.
    exception_mappers: tuple[
        Callable[[BaseException], tuple[str, str] | None], ...
    ] = ()

    #: Pipeline counters. None → observability.DEFAULT_METRICS.
    metrics: Any = None

    def __post_init__(self) -> None:
        """Startup validation — mirrors CookieProfileOptionsValidator (C#).

        An invalid cookie profile fails fast at options construction
        instead of shipping a weak cookie.
        """
        violations: list[str] = []
        for role in ("auth", "session", "csrf"):
            profile = getattr(self.cookies, role)
            for v in cookie_profile.validate_cookie_profile(profile, role):
                violations.append(f"{role}: {v}")
        if violations:
            raise ValueError(
                "Invalid cookie profile configuration: " + ", ".join(violations)
            )
