"""Fetch Metadata policy evaluation — mirrors FetchMetadataEvaluator (C#).

Compat and Strict produce IDENTICAL decisions — the profile distinction
exists only for startup validation. Off short-circuits to allow.
"""

from __future__ import annotations

from dataclasses import dataclass, field

FetchMetadataProfile = str  # "off" | "compat" | "strict"

_SPEC_SITE_VALUES = frozenset({"same-origin", "same-site", "cross-site", "none"})


@dataclass(slots=True)
class FetchMetadataOptions:
    """Fetch Metadata policy configuration."""

    profile: FetchMetadataProfile = "off"
    allowed_site_values: frozenset[str] = field(
        default_factory=lambda: frozenset({"same-origin", "same-site", "none"})
    )
    allowed_mode_values: frozenset[str] = field(
        default_factory=lambda: frozenset({"cors", "same-origin", "navigate"})
    )
    allow_missing_headers: bool = True


DEFAULT_FETCH_METADATA_OPTIONS = FetchMetadataOptions()


def _contains_ci(values: frozenset[str], value: str) -> bool:
    """Case-insensitive membership (mirrors OrdinalIgnoreCase HashSet)."""
    lowered = value.lower()
    return any(v.lower() == lowered for v in values)


@dataclass(frozen=True, slots=True)
class FetchMetadataDecision:
    """Evaluation result: decision + reason."""

    decision: str  # "allow" | "reject"
    reason: str  # "none" | "missingSiteHeader" | "malformedSiteHeader" | "disallowedSiteValue" | "disallowedModeValue"


_ALLOW = FetchMetadataDecision(decision="allow", reason="none")


def evaluate_fetch_metadata(
    site: str | None, mode: str | None, options: FetchMetadataOptions
) -> FetchMetadataDecision:
    """Evaluates Sec-Fetch-Site / Sec-Fetch-Mode under the profile.

    - Off: allow everything.
    - Missing/malformed site → allowMissingHeaders ? allow : reject.
    - Present well-formed site → case-insensitive allow-list check
      (AllowMissingHeaders NOT consulted).
    - Present mode → case-insensitive allow-list check.
    """
    if options.profile == "off":
        return _ALLOW

    site_missing = site is None or site == ""
    site_well_formed = (not site_missing) and site.lower() in _SPEC_SITE_VALUES

    if not site_well_formed:
        if options.allow_missing_headers:
            return _ALLOW
        return FetchMetadataDecision(
            decision="reject",
            reason="missingSiteHeader" if site_missing else "malformedSiteHeader",
        )

    # Present and well-formed — AllowMissingHeaders is not consulted.
    if not _contains_ci(options.allowed_site_values, site):
        return FetchMetadataDecision(decision="reject", reason="disallowedSiteValue")

    if mode is not None and mode != "" and not _contains_ci(options.allowed_mode_values, mode):
        return FetchMetadataDecision(decision="reject", reason="disallowedModeValue")

    return _ALLOW
