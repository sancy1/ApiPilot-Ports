"""Security diagnostics surface — mirrors ApiPilotSecurityDiagnostics (C#).

Reports non-fatal configuration observations. Fatal conditions are
enforced at middleware construction time, not here. Never exposes
secrets.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .csrf import DefaultCsrfBindingResolver
from .options import ApiPilotOptions


@dataclass(frozen=True, slots=True)
class Diagnostic:
    """A non-fatal configuration observation."""

    code: str
    level: str  # "info" | "warning"
    message: str


def _binding_configured(binding: Any) -> bool:
    if binding is None:
        return False
    if isinstance(binding, DefaultCsrfBindingResolver):
        return any(
            (
                binding.subject_extractor,
                binding.session_extractor,
                binding.pre_auth_source,
            )
        )
    return True  # custom resolvers are assumed configured


def diagnostics(options: ApiPilotOptions, binding: Any = None) -> list[Diagnostic]:
    """Returns non-fatal diagnostics for the resolved options."""
    out: list[Diagnostic] = []

    if options.csrf.enabled and not _binding_configured(binding):
        out.append(
            Diagnostic(
                code="csrf-no-binding",
                level="warning",
                message=(
                    "CSRF is enabled but no binding resolver extractors are "
                    "configured; all bindings resolve to null and requests "
                    "fail closed."
                ),
            )
        )

    if options.origin.enabled and not options.origin.allowed_origins:
        out.append(
            Diagnostic(
                code="origin-empty-allowlist",
                level="warning",
                message=(
                    "Origin policy is enabled with an empty allowlist; all "
                    "unsafe requests with an Origin header are rejected."
                ),
            )
        )

    if options.rate_limit.enabled and options.rate_limit.requests_per_window <= 0:
        out.append(
            Diagnostic(
                code="rate-limit-default-limit",
                level="info",
                message=(
                    "Rate limiting is enabled with the default limit of 100 "
                    "requests per window."
                ),
            )
        )

    return out


def key_ring_diagnostics(key_ring: Any, csrf_enabled: bool) -> list[Diagnostic]:
    """Inspects the CSRF key ring for multi-instance safety.

    Mirrors InstanceSafetyValidator + SharedKeyConfiguration (C#): a single
    key or missing keys are legal but risky at scale — every instance must
    share the same ring or tokens issued by one instance fail on another.
    """
    out: list[Diagnostic] = []
    if not csrf_enabled:
        return out
    keys = getattr(key_ring, "keys", None) or {}
    active_id = getattr(key_ring, "active_key_id", "")
    if not keys:
        out.append(
            Diagnostic(
                code="csrf-keys-missing",
                level="warning",
                message=(
                    "CSRF is enabled but no key ring is configured; tokens "
                    "cannot be issued or validated."
                ),
            )
        )
        return out
    if len(keys) == 1:
        out.append(
            Diagnostic(
                code="csrf-single-key",
                level="info",
                message=(
                    "CSRF key ring has a single key; rotation requires "
                    "downtime. Add a second key before rotating in "
                    "multi-instance deployments."
                ),
            )
        )
    if active_id not in keys:
        out.append(
            Diagnostic(
                code="csrf-active-key-missing",
                level="warning",
                message=(
                    "The CSRF active key ID is not present in the key ring; "
                    "new tokens cannot be signed."
                ),
            )
        )
    return out
