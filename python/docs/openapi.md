# OpenAPI

The Python port ships the canonical ApiPilot error-envelope schemas for
inclusion in an OpenAPI `components.schemas` object.

## Schemas (`apipilot.asgi.openapi`)

| Name | Schema |
| --- | --- |
| `ApiPilotErrorResponse` | `{ success: false, error: $ref, meta }` |
| `ApiPilotError` | `{ code, message, fields? }` |
| `ApiPilotErrorFields` | object → array of strings |

Individual builders: `error_envelope_schema()`, `error_object_schema()`,
`error_fields_schema()`.

## Usage

```python
from apipilot.asgi import openapi

schemas = openapi.error_schemas()
# merge into your OpenAPI document's components.schemas
```

The schemas describe the wire contract exactly — they are not
overridable. Path/operation generation is the application's
responsibility (FastAPI/Starlette generate their own OpenAPI; merge
these schemas into `components.schemas`).
