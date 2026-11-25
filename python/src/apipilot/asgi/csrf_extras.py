"""CSRF extras — rotation store, transition listener, endpoint policy resolver.

Mirrors ICsrfRotationStore, DefaultCsrfTransitionListener, and
CsrfEndpointPolicyResolver (C# ApiPilot.Security).

A rotation marker is the Unix timestamp of the last rotation for a
binding. A token whose issue time is before the marker is rejected with
outcome ``"rotated"``. The store is optional; when absent the service
operates in expiry-only rotation mode.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Protocol

from .csrf import CsrfBindingResolver, CsrfService

# ---------------------------------------------------------------------------
# Rotation store
# ---------------------------------------------------------------------------


class RotationStore(Protocol):
    """Persists rotation markers per binding fingerprint.

    Implementations must be safe for concurrent use across requests.
    """

    def get_rotation_marker(self, binding: str) -> int | None:
        """Returns the last-rotation Unix timestamp, or None."""
        ...

    def set_rotation_marker(self, binding: str, unix_seconds: int) -> None:
        """Records a rotation marker for the binding."""
        ...

    def clear_rotation_marker(self, binding: str) -> None:
        """Removes the marker for the binding."""
        ...


class InMemoryRotationStore:
    """Process-local RotationStore."""

    def __init__(self) -> None:
        self._markers: dict[str, int] = {}
        self._lock = threading.Lock()

    def get_rotation_marker(self, binding: str) -> int | None:
        with self._lock:
            return self._markers.get(binding)

    def set_rotation_marker(self, binding: str, unix_seconds: int) -> None:
        with self._lock:
            self._markers[binding] = unix_seconds

    def clear_rotation_marker(self, binding: str) -> None:
        with self._lock:
            self._markers.pop(binding, None)


# ---------------------------------------------------------------------------
# Service rotation wiring
# ---------------------------------------------------------------------------


def attach_rotation_store(service: CsrfService, store: RotationStore) -> CsrfService:
    """Attaches a rotation store to the service (monkey-patch free: sets a
    private attribute the service consults when present)."""
    service._rotation_store = store  # type: ignore[attr-defined]
    return service


def check_rotation(service: CsrfService, binding_fingerprint: str, issued_at: int) -> str | None:
    """Returns ``"rotated"`` when the token predates the binding's rotation
    marker, else None. Called after binding match, before expiry."""
    store = getattr(service, "_rotation_store", None)
    if store is None:
        return None
    marker = store.get_rotation_marker(binding_fingerprint)
    if marker is not None and issued_at < marker:
        return "rotated"
    return None


def mark_rotated(service: CsrfService, binding_fingerprint: str) -> None:
    """Records a rotation marker for the binding at the current time."""
    store = getattr(service, "_rotation_store", None)
    if store is not None:
        store.set_rotation_marker(binding_fingerprint, int(time.time()))


# ---------------------------------------------------------------------------
# Transition listener
# ---------------------------------------------------------------------------


class CsrfTransitionListener:
    """Issues fresh tokens on login and clears rotation markers on logout.

    Never authenticates users or writes cookies — the application owns its
    session lifecycle. Mirrors DefaultCsrfTransitionListener.
    """

    def __init__(
        self,
        service: CsrfService,
        binding_resolver: CsrfBindingResolver,
        rotation_store: RotationStore | None = None,
    ) -> None:
        self._service = service
        self._resolver = binding_resolver
        self._store = rotation_store

    def on_login(self, scope: dict[str, Any]) -> str | None:
        """Resolves the binding for the request and issues a fresh token.
        Returns None when no binding can be resolved — fail closed."""
        binding = self._resolver.resolve(scope)
        if binding is None:
            return None
        return self._service.issue_token(binding.source, binding.kind)

    def on_login_with_binding(self, source: str, kind: str) -> str:
        """Issues a fresh token for an explicit binding."""
        return self._service.issue_token(source, kind)

    def on_logout(self, scope: dict[str, Any]) -> None:
        """Clears the rotation marker for the request's binding when a store
        is registered. Safe before or after session teardown."""
        if self._store is None:
            return
        binding = self._resolver.resolve(scope)
        if binding is not None:
            self._store.clear_rotation_marker(binding.fingerprint)

    def on_logout_with_fingerprint(self, fingerprint: str) -> None:
        """Clears the rotation marker for an explicit binding fingerprint."""
        if self._store is not None and fingerprint:
            self._store.clear_rotation_marker(fingerprint)


# ---------------------------------------------------------------------------
# Endpoint policy resolver
# ---------------------------------------------------------------------------

POLICY_USE_GLOBAL = "useGlobal"
POLICY_REQUIRE = "require"
POLICY_SKIP = "skip"


def resolve_endpoint_policy(require: bool, skip: bool) -> str:
    """Combines per-route flags into the effective policy.

    Precedence: Require > Skip > UseGlobal — mirrors
    CsrfEndpointPolicyResolver. Later flags do not override earlier ones
    of higher precedence.
    """
    if require:
        return POLICY_REQUIRE
    if skip:
        return POLICY_SKIP
    return POLICY_USE_GLOBAL
