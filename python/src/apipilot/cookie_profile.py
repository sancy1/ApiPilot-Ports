"""Cookie profile validation — mirrors CookieProfileOptionsValidator (C#).

Startup-validation rules: prefix rules, path, domain, name charset,
SameSite requirements. Returns canonical violation codes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

CookieSameSite = Literal["lax", "none", "strict", "unspecified"]
CookieProfileRole = Literal["auth", "session", "csrf"]
NamePrefix = Literal["", "__Host-", "__Secure-"]

DEFINED_PREFIXES: tuple[str, ...] = ("", "__Host-", "__Secure-")


@dataclass(frozen=True, slots=True)
class CookieProfile:
    """A cookie profile under validation."""

    name: str
    secure: bool
    http_only: bool
    same_site: CookieSameSite
    path: str
    domain: str | None
    name_prefix: NamePrefix = ""


_FORBIDDEN_NAME_CHARS = re.compile(r'[\x00-\x20\x7f",;\\]')
_DOMAIN_RE = re.compile(r"^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$")


def _has_forbidden_name_char(name: str) -> bool:
    return _FORBIDDEN_NAME_CHARS.search(name) is not None


def _is_valid_domain(domain: str) -> bool:
    # No scheme, path, port, or whitespace; must look like a hostname.
    if re.search(r"[\s/:@]", domain):
        return False
    if not domain:
        return False
    return _DOMAIN_RE.match(domain) is not None


def validate_cookie_profile(profile: CookieProfile, role: CookieProfileRole) -> list[str]:
    """Validates a cookie profile. Returns violation codes ([] = valid).

    Mirrors CookieProfileOptionsValidator + HostPrefixValidator.
    """
    violations: list[str] = []
    effective_name = profile.name_prefix + profile.name

    if profile.name_prefix not in DEFINED_PREFIXES:
        violations.append("undefined-prefix")

    if not effective_name:
        violations.append("empty-name")
    elif _has_forbidden_name_char(effective_name):
        violations.append("forbidden-name-char")

    if profile.name_prefix == "__Host-":
        if not profile.secure:
            violations.append("host-prefix-requires-secure")
        if profile.domain is not None:
            violations.append("host-prefix-requires-no-domain")
        if profile.path != "/":
            violations.append("host-prefix-requires-root-path")

    if profile.name_prefix == "__Secure-" and not profile.secure:
        violations.append("secure-prefix-requires-secure")

    if profile.same_site == "none" and not profile.secure:
        violations.append("samesite-none-requires-secure")

    if profile.same_site == "unspecified":
        violations.append("undefined-samesite")

    if not profile.path or not profile.path.startswith("/"):
        violations.append("path-must-start-slash")

    if profile.domain is not None and not _is_valid_domain(profile.domain):
        violations.append("invalid-domain")

    return violations


#: The three default profiles from docs/cookies.md.
DEFAULT_COOKIE_PROFILES: dict[str, CookieProfile] = {
    "auth": CookieProfile(
        name="auth", secure=True, http_only=True, same_site="lax",
        path="/", domain=None, name_prefix="",
    ),
    "session": CookieProfile(
        name="session", secure=True, http_only=True, same_site="strict",
        path="/", domain=None, name_prefix="",
    ),
    "csrf": CookieProfile(
        name="csrf", secure=True, http_only=False, same_site="lax",
        path="/", domain=None, name_prefix="",
    ),
}
