// filepath: src/openapi.ts
// layer: OpenAPI | package: @apipilot/fastify | since: v0.1.0
// purpose: OpenAPI schema builders for the ApiPilot wire contract.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : n/a
//   Used by    : application OpenAPI document assembly
//   See also   : StandardErrorSchema.cs (C# reference)
// -----------------------------------------------------------------------------

export const ERROR_ENVELOPE_SCHEMA_NAME = "ApiPilotErrorResponse";
export const ERROR_OBJECT_SCHEMA_NAME = "ApiPilotError";
export const ERROR_FIELDS_SCHEMA_NAME = "ApiPilotErrorFields";

/** Error envelope schema: { success: false, error: $ref, meta }. */
export function errorEnvelopeSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      success: {
        type: "boolean",
        description: "Always false for an error response.",
        enum: [false],
      },
      error: { $ref: `#/components/schemas/${ERROR_OBJECT_SCHEMA_NAME}` },
      meta: {
        type: "object",
        description: "Non-business metadata.",
        properties: {
          requestId: {
            type: "string",
            description: "The correlation identifier for the request.",
          },
        },
      },
    },
    required: ["success", "error"],
  };
}

/** Nested error object schema: { code, message, fields? }. */
export function errorObjectSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "The stable, machine-readable error code.",
      },
      message: {
        type: "string",
        description: "A short, safe, human-readable message.",
      },
      fields: { $ref: `#/components/schemas/${ERROR_FIELDS_SCHEMA_NAME}` },
    },
    required: ["code", "message"],
  };
}

/** Field map schema: object whose values are arrays of messages. */
export function errorFieldsSchema(): Record<string, unknown> {
  return {
    type: "object",
    description: "Field-level errors, keyed by field name.",
    additionalProperties: {
      type: "array",
      items: { type: "string" },
    },
  };
}

/** All three schemas keyed by component name. */
export function errorSchemas(): Record<string, Record<string, unknown>> {
  return {
    [ERROR_ENVELOPE_SCHEMA_NAME]: errorEnvelopeSchema(),
    [ERROR_OBJECT_SCHEMA_NAME]: errorObjectSchema(),
    [ERROR_FIELDS_SCHEMA_NAME]: errorFieldsSchema(),
  };
}

export const PAGINATION_SCHEMA_NAME = "ApiPilotPagination";
export const OPENAPI_VERSION = "3.0.3";

/** Pagination metadata schema: the six-field pagination block. */
export function paginationSchema(): Record<string, unknown> {
  const intProp = (desc: string) => ({ type: "integer", description: desc });
  const boolProp = (desc: string) => ({ type: "boolean", description: desc });
  return {
    type: "object",
    properties: {
      page: intProp("The current page number."),
      pageSize: intProp("The number of items per page."),
      totalItems: intProp("The total number of items across all pages."),
      totalPages: intProp("The total number of pages."),
      hasNext: boolProp("Whether a next page exists."),
      hasPrevious: boolProp("Whether a previous page exists."),
    },
    required: ["page", "pageSize", "totalItems", "totalPages", "hasNext", "hasPrevious"],
  };
}

/** Configures the generated OpenAPI document — mirrors ApiPilotOpenApiOptions (C#). */
export interface OpenApiOptions {
  /** Route path serving the document. Default "/openapi/v1.json". */
  documentPath?: string;
  /** info.title. Default "ApiPilot API". */
  documentTitle?: string;
  /** info.version. Default "1.0.0". */
  documentVersion?: string;
  /** Include the three error schemas. Default true. */
  includeErrorSchemas?: boolean;
  /** Include the pagination schema. Default true. */
  includePaginationSchema?: boolean;
}

export const DEFAULT_OPENAPI_OPTIONS: Required<OpenApiOptions> = {
  documentPath: "/openapi/v1.json",
  documentTitle: "ApiPilot API",
  documentVersion: "1.0.0",
  includeErrorSchemas: true,
  includePaginationSchema: true,
};

/**
 * Builds the OpenAPI document skeleton: openapi version, info, empty
 * paths, and components.schemas derived from the options. Mirrors
 * ApiPilotSchemaDocument.Build (C#). Path items are the application's
 * responsibility.
 */
export function buildOpenApiDocument(options: OpenApiOptions = {}): Record<string, unknown> {
  const opts = { ...DEFAULT_OPENAPI_OPTIONS, ...options };
  const schemas: Record<string, unknown> = {};
  if (opts.includeErrorSchemas) Object.assign(schemas, errorSchemas());
  if (opts.includePaginationSchema) schemas[PAGINATION_SCHEMA_NAME] = paginationSchema();
  return {
    openapi: OPENAPI_VERSION,
    info: { title: opts.documentTitle, version: opts.documentVersion },
    paths: {},
    components: { schemas },
  };
}
