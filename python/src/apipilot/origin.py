"""Origin parsing and matching — mirrors OriginValidator (C#).

RFC 6454 origin parsing: ``scheme://host[:port]``. Scheme and host
lowercased; missing port → scheme default (0 when none). Rejects empty,
literal "null", non-absolute URIs, paths, queries, fragments. Never
throws — returns None on malformed input.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit

_DEFAULT_PORTS = {"https": 443, "http": 80, "wss": 443, "ws": 80}


@dataclass(frozen=True, slots=True)
class OriginParts:
    """Parsed origin parts. Port is 0 when the scheme has no default."""

    scheme: str
    host: str
    port: int


def _default_port(scheme: str) -> int:
    return _DEFAULT_PORTS.get(scheme, 0)


def try_parse_origin(raw: str) -> OriginParts | None:
    """Parses an origin string into normalized parts, or None."""
    if not raw or raw.lower() == "null":
        return None

    try:
        url = urlsplit(raw)
    except ValueError:
        return None

    scheme = (url.scheme or "").lower()
    host = (url.hostname or "").lower()
    if not scheme or not host:
        return None

    # An origin has no path (beyond "/"), query, or fragment.
    if url.path not in ("", "/"):
        return None
    if url.query or url.fragment:
        return None

    # Explicit port: urlsplit.port raises ValueError on invalid port.
    try:
        explicit_port = url.port
    except ValueError:
        return None
    port = explicit_port if explicit_port is not None else _default_port(scheme)

    return OriginParts(scheme=scheme, host=host, port=port)


def origin_matches(request_origin: str, allowed_origin: str, mode: str) -> bool:
    """Compares two origin strings under the given mode.

    Modes: "exact", "anyPortSameHost", "sameSite" (always False —
    not implemented, mirrors C#).
    """
    request = try_parse_origin(request_origin)
    allowed = try_parse_origin(allowed_origin)
    if request is None or allowed is None:
        return False

    if request.scheme != allowed.scheme or request.host != allowed.host:
        return False

    if mode == "exact":
        return request.port == allowed.port
    return mode == "anyPortSameHost"  # sameSite — not implemented
