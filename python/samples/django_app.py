"""Runnable ApiPilot + Django sample (ASGI deployment).

Django is WSGI-first; ApiPilot's ASGI middleware wraps the Django ASGI
application, so deploy with uvicorn/daphne/hypercorn — NOT gunicorn WSGI.

Run::

    cd python && pip install -e ".[asgi]" django uvicorn
    python samples/django_app.py

Then::

    curl http://localhost:8002/health/
    curl http://localhost:8002/api/csrf/ -H "X-Client-Id: demo"
    curl -X POST http://localhost:8002/api/items/ \
         -H "X-Client-Id: demo" -H "X-CSRF-Token: <token>" \
         -H "Origin: http://localhost:8002" -H "Content-Type: application/json" \
         -d '{"name": "widget"}'
"""

from __future__ import annotations

import base64
import os

# --- Django settings (minimal, no project scaffolding needed) -------------
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_app_settings")

import django
from django.conf import settings
from django.http import JsonResponse
from django.urls import path

if not settings.configured:
    settings.configure(
        DEBUG=True,
        SECRET_KEY="apipilot-sample-only-not-for-production",
        ROOT_URLCONF=__name__,
        ALLOWED_HOSTS=["*"],
        INSTALLED_APPS=["django.contrib.contenttypes", "django.contrib.auth"],
        MIDDLEWARE=[],
        DATABASES={},
        USE_TZ=True,
    )
    django.setup()

from apipilot.asgi import (
    ApiPilotASGIMiddleware,
    ApiPilotOptions,
    CsrfKeyRing,
    DefaultCsrfBindingResolver,
    generate_key_material,
)
from apipilot.asgi.options import (
    CsrfOptions,
    OriginPolicyOptions,
    RateLimitOptions,
)


def _header(scope: dict, name: bytes) -> str | None:
    for key, value in scope.get("headers", []):
        if key.lower() == name:
            return value.decode("latin-1")
    return None


# --- Django views ----------------------------------------------------------
def health(request):
    return JsonResponse({"status": "ok"})


def create_item(request):
    import json

    payload = json.loads(request.body or b"{}")
    return JsonResponse({"created": payload}, status=201)


urlpatterns = [
    path("health/", health),
    path("api/items/", create_item),
]

# --- ApiPilot wiring --------------------------------------------------------
options = ApiPilotOptions(
    csrf=CsrfOptions(enabled=True),
    origin=OriginPolicyOptions(
        enabled=True,
        allowed_origins=("http://localhost:8002",),
        require_origin_header=True,
    ),
    rate_limit=RateLimitOptions(
        enabled=True,
        requests_per_window=60,
        window_seconds=60,
    ),
    pagination_enabled=True,
)

key_ring = CsrfKeyRing(
    active_key_id="k1",
    keys={"k1": base64.b64decode(generate_key_material())},
)
binding = DefaultCsrfBindingResolver(
    pre_auth_source=lambda scope: _header(scope, b"x-client-id"),
)

# This is the pattern from the docs: wrap get_asgi_application() with the
# ApiPilot middleware. Equivalent to the asgi.py snippet:
#
#   django_app = get_asgi_application()
#   app = ApiPilotASGIMiddleware(django_app, options=..., csrf_key_ring=...)
from django.core.asgi import get_asgi_application

app = ApiPilotASGIMiddleware(
    get_asgi_application(),
    options=options,
    csrf_key_ring=key_ring,
    csrf_binding=binding,
)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8002)
