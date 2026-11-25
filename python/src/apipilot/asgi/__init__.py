"""apipilot.asgi — the ASGI adapter for ApiPilot.

Pure ASGI middleware covering FastAPI, Starlette, and any ASGI-capable
framework (including Django via its ASGI handler). The core logic lives
in ``apipilot`` (framework-neutral); this subpackage is the HTTP binding.

Install with::

    pip install "apipilot[asgi]"
"""

from . import csrf_extras, diagnostics, observability, openapi, serialization
from .csrf import (
    CsrfBindingResolver,
    CsrfKeyRing,
    CsrfProtector,
    CsrfService,
    DefaultCsrfBindingResolver,
    generate_key_material,
    key_ring_from_env,
)
from .middleware import ApiPilotASGIMiddleware, ApiPilotOptions
from .responses import (
    send_error,
    send_paginated,
    send_success,
    send_validation_error,
)

__all__ = [
    "ApiPilotASGIMiddleware",
    "ApiPilotOptions",
    "CsrfBindingResolver",
    "CsrfKeyRing",
    "CsrfProtector",
    "CsrfService",
    "DefaultCsrfBindingResolver",
    "csrf_extras",
    "diagnostics",
    "generate_key_material",
    "key_ring_from_env",
    "observability",
    "openapi",
    "send_error",
    "send_paginated",
    "send_success",
    "send_validation_error",
    "serialization",
]
