"""CSRF binding fingerprint — mirrors CsrfBindingProvider.Fingerprint (C#).

SHA-256 over ``"ApiPilot.Csrf.Binding.v1|" + prefixedSource`` (UTF-8),
output as unpadded base64url (43 chars). The prefixed source is:

- subject → ``source`` (raw)
- session → ``"session:" + source``
- preauth → ``"preauth:" + source``

Deterministic across restarts and languages — pinned by known-answer
vectors. Must match the TypeScript and Go ports byte-for-byte.
"""

from __future__ import annotations

import base64
import hashlib

CSRF_BINDING_PURPOSE = "ApiPilot.Csrf.Binding.v1"

CsrfBindingKind = str  # "subject" | "session" | "preauth"


def csrf_binding_fingerprint(source: str, kind: CsrfBindingKind) -> str:
    """Computes the binding fingerprint for a source + kind pair."""
    if kind == "session":
        prefixed = f"session:{source}"
    elif kind == "preauth":
        prefixed = f"preauth:{source}"
    else:
        prefixed = source

    material = f"{CSRF_BINDING_PURPOSE}|{prefixed}".encode()
    digest = hashlib.sha256(material).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
