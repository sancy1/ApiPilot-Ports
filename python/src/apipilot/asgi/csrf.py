"""CSRF protection for the ASGI adapter — protector, service, binding.

Mirrors the TypeScript adapter's csrf/* modules and the C#
CsrfProtector/CsrfService/CsrfBindingProvider. The cryptographic
boundary is AES-256-GCM with a shared key ring and purpose isolation —
the Data-Protection equivalent.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .. import csrf_binding, csrf_format

PURPOSE_DEFAULT = "ApiPilot.Csrf.v1"
VERSION = "v1"


@dataclass(slots=True)
class CsrfKeyRing:
    """Key ring: active key id + keyId → 32-byte key material."""

    active_key_id: str
    keys: dict[str, bytes] = field(default_factory=dict)


class CsrfProtector:
    """Protects/unprotects CSRF token payloads (AES-256-GCM + key ring).

    Wire format (base64url segments joined by ``.``):
        v1.<keyId>.<iv>.<ciphertext>.<tag>
    """

    def __init__(self, key_ring: CsrfKeyRing, purpose: str = PURPOSE_DEFAULT) -> None:
        self._purpose = purpose
        self._ring = key_ring
        if key_ring.active_key_id not in key_ring.keys:
            raise ValueError(
                "CsrfProtector: active_key_id is not present in the key ring."
            )
        for kid, key in key_ring.keys.items():
            if len(key) != 32:
                raise ValueError(
                    f'CsrfProtector: key "{kid}" must be 32 bytes (AES-256).'
                )

    def protect(self, plaintext: str) -> str:
        """Encrypts a UTF-8 payload into the wire token."""
        key = self._ring.keys[self._ring.active_key_id]
        iv = os.urandom(12)
        aesgcm = AESGCM(key)
        ct_with_tag = aesgcm.encrypt(
            iv, plaintext.encode("utf-8"), self._purpose.encode("utf-8")
        )
        ct, tag = ct_with_tag[:-16], ct_with_tag[-16:]
        return ".".join(
            [
                VERSION,
                self._ring.active_key_id,
                base64.urlsafe_b64encode(iv).rstrip(b"=").decode("ascii"),
                base64.urlsafe_b64encode(ct).rstrip(b"=").decode("ascii"),
                base64.urlsafe_b64encode(tag).rstrip(b"=").decode("ascii"),
            ]
        )

    def unprotect(self, token: str) -> str | None:
        """Decrypts a wire token. Returns plaintext or None on ANY failure."""
        parts = token.split(".")
        if len(parts) != 5 or parts[0] != VERSION:
            return None
        _, key_id, iv_b64, ct_b64, tag_b64 = parts
        key = self._ring.keys.get(key_id)
        if key is None:
            return None
        try:
            iv = base64.urlsafe_b64decode(iv_b64 + "=" * (-len(iv_b64) % 4))
            ct = base64.urlsafe_b64decode(ct_b64 + "=" * (-len(ct_b64) % 4))
            tag = base64.urlsafe_b64decode(tag_b64 + "=" * (-len(tag_b64) % 4))
            if len(iv) != 12 or len(tag) != 16:
                return None
            aesgcm = AESGCM(key)
            pt = aesgcm.decrypt(iv, ct + tag, self._purpose.encode("utf-8"))
            return pt.decode("utf-8")
        except (ValueError, binascii.Error, InvalidTag, UnicodeDecodeError):
            return None


def key_ring_from_env(env: dict[str, str] | None = None) -> CsrfKeyRing:
    """Builds a key ring from APIPILOT_CSRF_KEYS / APIPILOT_CSRF_ACTIVE_KEY.

    APIPILOT_CSRF_KEYS is a comma-separated list of ``keyId:base64key``
    pairs. All instances sharing the same env config share the same ring.
    """
    env = env if env is not None else dict(os.environ)
    raw = env.get("APIPILOT_CSRF_KEYS")
    active = env.get("APIPILOT_CSRF_ACTIVE_KEY")
    if not raw or not active:
        raise ValueError(
            "APIPILOT_CSRF_KEYS and APIPILOT_CSRF_ACTIVE_KEY are required for CSRF protection."
        )
    keys: dict[str, bytes] = {}
    for entry in raw.split(","):
        idx = entry.find(":")
        if idx <= 0:
            raise ValueError(f'Malformed APIPILOT_CSRF_KEYS entry: "{entry}".')
        kid = entry[:idx].strip()
        keys[kid] = base64.b64decode(entry[idx + 1 :].strip())
    return CsrfKeyRing(active_key_id=active.strip(), keys=keys)


def generate_key_material() -> str:
    """Generates a fresh 32-byte key, base64-encoded, for key-ring bootstrap."""
    return base64.b64encode(os.urandom(32)).decode("ascii")


def safe_equal(a: str, b: str) -> bool:
    """Constant-time string comparison."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def hmac_sha256(key: bytes, data: str) -> bytes:
    """HMAC-SHA256 helper retained for binding-adjacent uses."""
    return hmac.new(key, data.encode("utf-8"), hashlib.sha256).digest()


# ---------------------------------------------------------------------------
# Binding resolution
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CsrfBindingResult:
    """Resolved binding: fingerprint + raw source + kind."""

    fingerprint: str
    source: str
    kind: str  # "subject" | "session" | "preauth"


class CsrfBindingResolver(Protocol):
    """Resolves the CSRF binding for a request scope."""

    def resolve(self, scope: dict[str, Any]) -> CsrfBindingResult | None: ...


@dataclass(slots=True)
class DefaultCsrfBindingResolver:
    """Resolution order: subject → session → preauth. Never anonymous."""

    subject_extractor: Callable[[dict[str, Any]], str | None] | None = None
    session_extractor: Callable[[dict[str, Any]], str | None] | None = None
    pre_auth_source: Callable[[dict[str, Any]], str | None] | None = None

    def resolve(self, scope: dict[str, Any]) -> CsrfBindingResult | None:
        subject = self.subject_extractor(scope) if self.subject_extractor else None
        if subject:
            return CsrfBindingResult(
                fingerprint=csrf_binding.csrf_binding_fingerprint(subject, "subject"),
                source=subject,
                kind="subject",
            )
        session_id = self.session_extractor(scope) if self.session_extractor else None
        if session_id:
            return CsrfBindingResult(
                fingerprint=csrf_binding.csrf_binding_fingerprint(
                    session_id, "session"
                ),
                source=session_id,
                kind="session",
            )
        pre_auth = self.pre_auth_source(scope) if self.pre_auth_source else None
        if pre_auth:
            return CsrfBindingResult(
                fingerprint=csrf_binding.csrf_binding_fingerprint(pre_auth, "preauth"),
                source=pre_auth,
                kind="preauth",
            )
        return None


# ---------------------------------------------------------------------------
# Token service
# ---------------------------------------------------------------------------

CsrfValidationOutcome = str  # valid | missingToken | invalidSignature | malformedPayload | expired | bindingMismatch | missingBinding | rotated


@dataclass(frozen=True, slots=True)
class CsrfValidationResult:
    """Validation outcome + optional binding fingerprint."""

    outcome: CsrfValidationOutcome
    binding_fingerprint: str | None = None


class CsrfService:
    """Issues and validates CSRF tokens. Stateless — validity derives from
    the protected payload (signature + expiry + binding), not server state.
    Mirrors CsrfService.
    """

    def __init__(
        self,
        protector: CsrfProtector,
        binding_resolver: CsrfBindingResolver,
        token_lifetime_seconds: int = 7200,
        token_entropy_bytes: int = 32,
        now: Callable[[], float] | None = None,
    ) -> None:
        self._protector = protector
        self._binding = binding_resolver
        self._lifetime = token_lifetime_seconds
        self._entropy = token_entropy_bytes
        self._now = now or time.time

    def issue_token(self, binding_source: str, binding_kind: str) -> str:
        """Issues a new token bound to the current request context."""
        fingerprint = csrf_binding.csrf_binding_fingerprint(
            binding_source, binding_kind
        )
        issued_at = int(self._now())
        random_part = (
            base64.urlsafe_b64encode(os.urandom(self._entropy))
            .rstrip(b"=")
            .decode("ascii")
        )
        payload = csrf_format.encode_csrf_payload(issued_at, random_part, fingerprint)
        return self._protector.protect(payload)

    def validate_token(
        self, token: str | None, expected_fingerprint: str
    ) -> CsrfValidationResult:
        """Validates a wire token. Outcome ordering: signature → decode →
        binding → expiry (mirrors CsrfService.ValidateWithMetadata)."""
        if not token:
            return CsrfValidationResult(outcome="missingToken")

        plaintext = self._protector.unprotect(token)
        if plaintext is None:
            return CsrfValidationResult(outcome="invalidSignature")

        parts = csrf_format.try_decode_csrf_payload(plaintext)
        if parts is None:
            return CsrfValidationResult(outcome="malformedPayload")

        if parts.binding_fingerprint != expected_fingerprint:
            return CsrfValidationResult(outcome="bindingMismatch")

        # Rotation check (optional store attached via csrf_extras).
        store = getattr(self, "_rotation_store", None)
        if store is not None:
            marker = store.get_rotation_marker(parts.binding_fingerprint)
            if marker is not None and parts.issued_at_unix_seconds < marker:
                return CsrfValidationResult(
                    outcome="rotated", binding_fingerprint=parts.binding_fingerprint
                )

        age = int(self._now()) - parts.issued_at_unix_seconds
        if age > self._lifetime:
            return CsrfValidationResult(outcome="expired")

        return CsrfValidationResult(
            outcome="valid", binding_fingerprint=parts.binding_fingerprint
        )
