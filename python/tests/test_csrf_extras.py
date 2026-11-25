"""Tests for CSRF extras (rotation store, transition listener, endpoint
policy) and observability (metrics, redaction)."""

from __future__ import annotations

import base64
import time

from apipilot import csrf_binding
from apipilot.asgi import (
    CsrfKeyRing,
    CsrfProtector,
    CsrfService,
    DefaultCsrfBindingResolver,
    csrf_extras,
    generate_key_material,
    observability,
)

KEY_RING = CsrfKeyRing(
    active_key_id="k1",
    keys={"k1": base64.b64decode(generate_key_material())},
)


def _binding() -> DefaultCsrfBindingResolver:
    return DefaultCsrfBindingResolver(
        pre_auth_source=lambda scope: "client-1",
    )


def _service(store=None) -> CsrfService:
    svc = CsrfService(CsrfProtector(KEY_RING), _binding())
    if store is not None:
        csrf_extras.attach_rotation_store(svc, store)
    return svc


def _scope() -> dict:
    return {"type": "http", "method": "GET", "path": "/", "headers": []}


# --- Rotation store ---------------------------------------------------------


def test_in_memory_rotation_store() -> None:
    store = csrf_extras.InMemoryRotationStore()
    assert store.get_rotation_marker("b1") is None
    store.set_rotation_marker("b1", 1234)
    assert store.get_rotation_marker("b1") == 1234
    store.clear_rotation_marker("b1")
    assert store.get_rotation_marker("b1") is None


def test_rotation_rejects_pre_marker_token() -> None:
    store = csrf_extras.InMemoryRotationStore()
    svc = _service(store)
    token = svc.issue_token("client-1", "preauth")
    fp = csrf_binding.csrf_binding_fingerprint("client-1", "preauth")

    assert svc.validate_token(token, fp).outcome == "valid"

    store.set_rotation_marker(fp, int(time.time()) + 3600)
    assert svc.validate_token(token, fp).outcome == "rotated"

    store.clear_rotation_marker(fp)
    assert svc.validate_token(token, fp).outcome == "valid"


def test_no_store_means_no_rotation() -> None:
    svc = _service()  # no store attached
    token = svc.issue_token("client-1", "preauth")
    fp = csrf_binding.csrf_binding_fingerprint("client-1", "preauth")
    assert svc.validate_token(token, fp).outcome == "valid"


# --- Transition listener ----------------------------------------------------


def test_transition_listener_login_logout() -> None:
    store = csrf_extras.InMemoryRotationStore()
    svc = _service(store)
    listener = csrf_extras.CsrfTransitionListener(svc, _binding(), store)

    token = listener.on_login(_scope())
    assert token

    # Unresolvable binding → fail closed.
    empty = DefaultCsrfBindingResolver()
    listener2 = csrf_extras.CsrfTransitionListener(svc, empty, store)
    assert listener2.on_login(_scope()) is None

    fp = csrf_binding.csrf_binding_fingerprint("client-1", "preauth")
    store.set_rotation_marker(fp, int(time.time()) + 3600)
    listener.on_logout(_scope())
    assert store.get_rotation_marker(fp) is None


def test_transition_listener_explicit_fingerprint() -> None:
    store = csrf_extras.InMemoryRotationStore()
    svc = _service(store)
    listener = csrf_extras.CsrfTransitionListener(svc, _binding(), store)

    tok = listener.on_login_with_binding("client-1", "preauth")
    assert tok
    listener.on_logout_with_fingerprint("fp-x")
    # No marker set → no-op, no error.


# --- Endpoint policy resolver ------------------------------------------------


def test_resolve_endpoint_policy() -> None:
    assert csrf_extras.resolve_endpoint_policy(False, False) == "useGlobal"
    assert csrf_extras.resolve_endpoint_policy(True, False) == "require"
    assert csrf_extras.resolve_endpoint_policy(False, True) == "skip"
    # Require beats Skip.
    assert csrf_extras.resolve_endpoint_policy(True, True) == "require"


# --- Observability ------------------------------------------------------------


def test_metrics_counters() -> None:
    m = observability.Metrics()
    m.record_csrf_issued()
    m.record_csrf_validated()
    m.record_csrf_rejected()
    m.record_csrf_expired()
    m.record_rate_limited()
    m.record_validation_failed()
    m.record_origin_rejected()
    m.record_fetch_metadata_rejected()
    m.record_cookie_rejected()
    snap = m.snapshot()
    assert snap["csrf.issued"] == 1
    assert snap["csrf.validated"] == 1
    assert snap["csrf.rejected"] == 1
    assert snap["csrf.expired"] == 1
    assert snap["rate_limited"] == 1
    assert snap["validation_failed"] == 1
    assert snap["origin_rejected"] == 1
    assert snap["fetch_metadata_rejected"] == 1
    assert snap["cookie_rejected"] == 1


def test_redact_string() -> None:
    out = observability.redact_string("password=hunter2 token=abc123 Bearer xyz")
    assert "hunter2" not in out
    assert "abc123" not in out
    assert "xyz" not in out
    assert "[REDACTED]" in out


def test_redact_value() -> None:
    data = {
        "username": "alice",
        "password": "secret",
        "nested": {"api_key": "k", "ok": "fine"},
    }
    out = observability.redact_map(data)
    assert out["password"] == "[REDACTED]"
    assert out["username"] == "alice"
    assert out["nested"]["api_key"] == "[REDACTED]"
    assert out["nested"]["ok"] == "fine"
