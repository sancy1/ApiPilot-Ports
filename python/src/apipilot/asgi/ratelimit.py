"""Fixed-window rate limiter — mirrors the ApiPilot rate-limit rejection
surface (docs/rate-limiting.md, Option D).

Rejections emit a RATE_LIMITED envelope with an optional Retry-After
header computed from the window reset — never invented.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class _Window:
    count: int = 0
    reset_at: float = 0.0


class RateLimiter:
    """Fixed-window limiter keyed by client identity."""

    def __init__(
        self,
        limit: int,
        window_seconds: int,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._limit = limit
        self._window = window_seconds
        self._now = now
        self._windows: dict[str, _Window] = {}

    def allow(self, key: str) -> tuple[bool, int]:
        """Returns (allowed, retry_after_seconds). retry_after >= 1 when denied."""
        now = self._now()
        w = self._windows.get(key)
        if w is None or now >= w.reset_at:
            self._windows[key] = _Window(count=1, reset_at=now + self._window)
            return True, 0
        if w.count >= self._limit:
            remaining = w.reset_at - now
            secs = max(1, int(remaining))
            return False, secs
        w.count += 1
        return True, 0


def client_key(scope: dict[str, Any]) -> str:
    """Default key extractor: client host from scope, else 'anonymous'."""
    client = scope.get("client")
    if client and client[0]:
        return client[0]
    return "anonymous"
