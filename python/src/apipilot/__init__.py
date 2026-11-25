"""apipilot — ApiPilot for Python.

Framework-neutral core (envelopes, error codes, pagination, validation
keys, origin, fetch-metadata, cookie rules, CSRF format and binding) plus
an optional ASGI adapter (``apipilot.asgi``) covering FastAPI, Starlette,
and ASGI-capable Django.

The core has zero dependencies. Install the adapter with::

    pip install "apipilot[asgi]"
"""

from . import (
    content_negotiation,
    cookie_profile,
    correlation,
    csrf_binding,
    csrf_format,
    envelope,
    error_codes,
    fetch_metadata,
    field_key,
    origin,
    pagination,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "content_negotiation",
    "cookie_profile",
    "correlation",
    "csrf_binding",
    "csrf_format",
    "envelope",
    "error_codes",
    "fetch_metadata",
    "field_key",
    "origin",
    "pagination",
]
