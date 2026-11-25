"""Observability surface — mirrors ApiPilotCsrfCounters,
ApiPilotRedactionPolicy, and ApiPilotSafeLogger (C#).

Counters are in-memory and per-process; for multi-instance aggregation
export them to your metrics pipeline.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class Metrics:
    """ApiPilot request-pipeline counters."""

    csrf_issued: int = 0
    csrf_validated: int = 0
    csrf_rejected: int = 0
    csrf_expired: int = 0
    rate_limited: int = 0
    validation_failed: int = 0
    origin_rejected: int = 0
    fetch_metadata_rejected: int = 0
    cookie_rejected: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def _inc(self, name: str) -> None:
        with self._lock:
            setattr(self, name, getattr(self, name) + 1)

    def record_csrf_issued(self) -> None:
        self._inc("csrf_issued")

    def record_csrf_validated(self) -> None:
        self._inc("csrf_validated")

    def record_csrf_rejected(self) -> None:
        self._inc("csrf_rejected")

    def record_csrf_expired(self) -> None:
        self._inc("csrf_expired")

    def record_rate_limited(self) -> None:
        self._inc("rate_limited")

    def record_validation_failed(self) -> None:
        self._inc("validation_failed")

    def record_origin_rejected(self) -> None:
        self._inc("origin_rejected")

    def record_fetch_metadata_rejected(self) -> None:
        self._inc("fetch_metadata_rejected")

    def record_cookie_rejected(self) -> None:
        self._inc("cookie_rejected")

    def snapshot(self) -> dict[str, int]:
        """Returns a copy of the current counter values."""
        with self._lock:
            return {
                "csrf.issued": self.csrf_issued,
                "csrf.validated": self.csrf_validated,
                "csrf.rejected": self.csrf_rejected,
                "csrf.expired": self.csrf_expired,
                "rate_limited": self.rate_limited,
                "validation_failed": self.validation_failed,
                "origin_rejected": self.origin_rejected,
                "fetch_metadata_rejected": self.fetch_metadata_rejected,
                "cookie_rejected": self.cookie_rejected,
            }


#: Shared default metrics instance used when ApiPilotOptions.metrics is None.
DEFAULT_METRICS = Metrics()


@dataclass(frozen=True, slots=True)
class RedactionPolicy:
    """Controls which log fields are masked. Mirrors ApiPilotRedactionPolicy."""

    sensitive_keys: tuple[str, ...] = (
        "password", "passwd", "secret", "token", "apikey", "api_key",
        "authorization", "cookie", "session", "csrf", "creditcard",
        "ssn", "privatekey", "private_key",
    )


DEFAULT_REDACTION_POLICY = RedactionPolicy()

_BEARER_RE = re.compile(r"(?i)bearer\s+[a-z0-9\-._~+/]+=*")


def redact_string(value: str, policy: RedactionPolicy = DEFAULT_REDACTION_POLICY) -> str:
    """Masks bearer tokens and sensitive key=value pairs in a string."""
    out = _BEARER_RE.sub("Bearer [REDACTED]", value)
    for key in policy.sensitive_keys:
        pattern = re.compile(
            r"(" + re.escape(key) + r")(\s*[=:]\s*)([^\s,;&]+)", re.IGNORECASE
        )
        out = pattern.sub(r"\1\2[REDACTED]", out)
    return out


def redact_map(value: dict[str, Any], policy: RedactionPolicy = DEFAULT_REDACTION_POLICY) -> dict[str, Any]:
    """Returns a copy of the map with sensitive values masked."""
    out: dict[str, Any] = {}
    for k, v in value.items():
        lower = str(k).lower()
        if any(sk in lower for sk in policy.sensitive_keys):
            out[k] = "[REDACTED]"
            continue
        if isinstance(v, str):
            out[k] = redact_string(v, policy)
        elif isinstance(v, dict):
            out[k] = redact_map(v, policy)
        else:
            out[k] = v
    return out
