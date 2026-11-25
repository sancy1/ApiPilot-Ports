"""CSRF token plaintext payload codec — mirrors CsrfTokenFormat (C#).

Wire format: ``{issuedAtUnixSeconds}|{randomBase64Url}|{bindingFingerprint}``
joined by ``|`` delimiters. This module performs NO cryptography — it
only encodes/decodes the plaintext structure. The wire token is the
output of the language's AEAD/MAC protector applied to this payload.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

CSRF_DELIMITER = "|"

#: Unix-seconds bounds mirroring DateTimeOffset.ToUnixTimeSeconds() range.
MIN_UNIX_SECONDS = -62135596800
MAX_UNIX_SECONDS = 253402300799

_TIME_RE = re.compile(r"^[+-]?\d+$")


@dataclass(frozen=True, slots=True)
class CsrfPayloadParts:
    """Decoded plaintext payload."""

    issued_at_unix_seconds: int
    random_base64_url: str
    binding_fingerprint: str


def encode_csrf_payload(
    issued_at_unix_seconds: int, random_base64_url: str, binding_fingerprint: str
) -> str:
    """Encodes payload parts into the pipe-delimited plaintext.

    Raises:
        ValueError: on empty parts, delimiter inside parts, or non-integer time.
    """
    if not isinstance(issued_at_unix_seconds, int) or isinstance(
        issued_at_unix_seconds, bool
    ):
        raise TypeError("issuedAtUnixSeconds must be an integer.")
    if not random_base64_url:
        raise ValueError("randomBase64Url must not be empty.")
    if not binding_fingerprint:
        raise ValueError("bindingFingerprint must not be empty.")
    if CSRF_DELIMITER in random_base64_url:
        raise ValueError("randomBase64Url must not contain the pipe delimiter.")
    if CSRF_DELIMITER in binding_fingerprint:
        raise ValueError("bindingFingerprint must not contain the pipe delimiter.")
    return f"{issued_at_unix_seconds}{CSRF_DELIMITER}{random_base64_url}{CSRF_DELIMITER}{binding_fingerprint}"


def try_decode_csrf_payload(payload: str) -> CsrfPayloadParts | None:
    """Decodes a pipe-delimited payload. Returns None on any structural violation.

    Mirrors CsrfTokenFormat.TryDecode — deliberately lenient: only
    structure (3 non-empty parts, integer time in range) is checked.
    """
    if not payload:
        return None

    parts = payload.split(CSRF_DELIMITER)
    if len(parts) != 3:
        return None

    time_raw, random, binding = parts
    if not time_raw or not random or not binding:
        return None
    if not _TIME_RE.match(time_raw):
        return None

    try:
        issued_at = int(time_raw, 10)
    except ValueError:
        return None
    if issued_at < MIN_UNIX_SECONDS or issued_at > MAX_UNIX_SECONDS:
        return None

    return CsrfPayloadParts(
        issued_at_unix_seconds=issued_at,
        random_base64_url=random,
        binding_fingerprint=binding,
    )
