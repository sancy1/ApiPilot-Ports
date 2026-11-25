"""Correlation ID policy — mirrors CorrelationMiddleware logic (C#).

Pure decision logic: the adapter supplies the header value and pattern
match result; this module decides generate / use-incoming / reject.
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from typing import Literal

CorrelationInvalidIdPolicy = Literal["replace", "reject", "useAsIs"]

#: Default validation pattern — GUIDv7-shaped or generic safe token.
DEFAULT_VALIDATION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$")


@dataclass(frozen=True, slots=True)
class CorrelationOptions:
    """Correlation policy configuration."""

    header_name: str = "X-Request-Id"
    validation_pattern: re.Pattern[str] = DEFAULT_VALIDATION_PATTERN
    invalid_id_policy: CorrelationInvalidIdPolicy = "replace"
    echo_in_response_header: bool = True
    echo_in_response_body: bool = True


DEFAULT_CORRELATION_OPTIONS = CorrelationOptions()


@dataclass(frozen=True, slots=True)
class CorrelationDecision:
    """Decision result: kind + optional id + warn flag."""

    kind: Literal["use-incoming", "generate", "reject"]
    id: str | None = None
    warn: bool = False


def resolve_correlation_id(
    header_value: str | None,
    options: CorrelationOptions,
    pattern_matches: bool,
) -> CorrelationDecision:
    """Decides the effective correlation ID for a request.

    - absent/empty header → generate
    - present + pattern match → use incoming
    - present + no match → policy: replace→generate, reject→reject,
      useAsIs→use+warn
    """
    if header_value is None or header_value == "":
        return CorrelationDecision(kind="generate")
    if pattern_matches:
        return CorrelationDecision(kind="use-incoming", id=header_value)

    if options.invalid_id_policy == "reject":
        return CorrelationDecision(kind="reject")
    if options.invalid_id_policy == "useAsIs":
        return CorrelationDecision(kind="use-incoming", id=header_value, warn=True)
    return CorrelationDecision(kind="generate")


def generate_guid_v7() -> str:
    """Generates a GUIDv7 correlation ID (RFC 9562, time-ordered)."""
    rand = bytearray(os.urandom(16))
    now_ms = int(time.time() * 1000)

    # 48-bit big-endian unix_ts_ms into bytes 0-5
    for i in range(6):
        rand[i] = (now_ms >> (40 - 8 * i)) & 0xFF

    # version 7 in high nibble of byte 6
    rand[6] = (rand[6] & 0x0F) | 0x70
    # variant 10xx in high bits of byte 8
    rand[8] = (rand[8] & 0x3F) | 0x80

    hex_str = rand.hex()
    return f"{hex_str[0:8]}-{hex_str[8:12]}-{hex_str[12:16]}-{hex_str[16:20]}-{hex_str[20:32]}"
