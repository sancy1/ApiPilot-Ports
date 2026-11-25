"""OpenAPI schema builders for the ApiPilot wire contract.

Mirrors StandardErrorSchema (C#): the error envelope, nested error
object, and field map schemas, expressed as plain dicts ready to merge
into an OpenAPI components.schemas object.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

ERROR_ENVELOPE_SCHEMA_NAME = "ApiPilotErrorResponse"
ERROR_OBJECT_SCHEMA_NAME = "ApiPilotError"
ERROR_FIELDS_SCHEMA_NAME = "ApiPilotErrorFields"


def error_envelope_schema() -> dict[str, Any]:
    """Error envelope schema: { success: false, error: $ref, meta }."""
    return {
        "type": "object",
        "properties": {
            "success": {
                "type": "boolean",
                "description": "Always false for an error response.",
                "enum": [False],
            },
            "error": {"$ref": f"#/components/schemas/{ERROR_OBJECT_SCHEMA_NAME}"},
            "meta": {
                "type": "object",
                "description": "Non-business metadata.",
                "properties": {
                    "requestId": {
                        "type": "string",
                        "description": "The correlation identifier for the request.",
                    }
                },
            },
        },
        "required": ["success", "error"],
    }


def error_object_schema() -> dict[str, Any]:
    """Nested error object schema: { code, message, fields? }."""
    return {
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "description": "The stable, machine-readable error code.",
            },
            "message": {
                "type": "string",
                "description": "A short, safe, human-readable message.",
            },
            "fields": {"$ref": f"#/components/schemas/{ERROR_FIELDS_SCHEMA_NAME}"},
        },
        "required": ["code", "message"],
    }


def error_fields_schema() -> dict[str, Any]:
    """Field map schema: object whose values are arrays of messages."""
    return {
        "type": "object",
        "description": "Field-level errors, keyed by field name.",
        "additionalProperties": {
            "type": "array",
            "items": {"type": "string"},
        },
    }


def error_schemas() -> dict[str, dict[str, Any]]:
    """All three schemas keyed by component name."""
    return {
        ERROR_ENVELOPE_SCHEMA_NAME: error_envelope_schema(),
        ERROR_OBJECT_SCHEMA_NAME: error_object_schema(),
        ERROR_FIELDS_SCHEMA_NAME: error_fields_schema(),
    }


PAGINATION_SCHEMA_NAME = "ApiPilotPagination"
OPENAPI_VERSION = "3.0.3"


def pagination_schema() -> dict[str, Any]:
    """Pagination metadata schema: the six-field pagination block."""

    def int_prop(desc: str) -> dict[str, Any]:
        return {"type": "integer", "description": desc}

    def bool_prop(desc: str) -> dict[str, Any]:
        return {"type": "boolean", "description": desc}

    return {
        "type": "object",
        "properties": {
            "page": int_prop("The current page number."),
            "pageSize": int_prop("The number of items per page."),
            "totalItems": int_prop("The total number of items across all pages."),
            "totalPages": int_prop("The total number of pages."),
            "hasNext": bool_prop("Whether a next page exists."),
            "hasPrevious": bool_prop("Whether a previous page exists."),
        },
        "required": [
            "page",
            "pageSize",
            "totalItems",
            "totalPages",
            "hasNext",
            "hasPrevious",
        ],
    }


@dataclass(frozen=True, slots=True)
class OpenApiOptions:
    """Configures the generated OpenAPI document.

    Mirrors ApiPilotOpenApiOptions (C#).
    """

    document_path: str = "/openapi/v1.json"
    document_title: str = "ApiPilot API"
    document_version: str = "1.0.0"
    include_error_schemas: bool = True
    include_pagination_schema: bool = True


def build_openapi_document(options: OpenApiOptions | None = None) -> dict[str, Any]:
    """Builds the OpenAPI document skeleton: openapi version, info, empty
    paths, and components.schemas derived from the options.

    Mirrors ApiPilotSchemaDocument.Build (C#). Path items are the
    application's responsibility.
    """
    opts = options or OpenApiOptions()
    schemas: dict[str, Any] = {}
    if opts.include_error_schemas:
        schemas.update(error_schemas())
    if opts.include_pagination_schema:
        schemas[PAGINATION_SCHEMA_NAME] = pagination_schema()
    return {
        "openapi": OPENAPI_VERSION,
        "info": {"title": opts.document_title, "version": opts.document_version},
        "paths": {},
        "components": {"schemas": schemas},
    }
