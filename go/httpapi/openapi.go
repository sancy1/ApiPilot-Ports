package httpapi

// OpenAPI schema builders for the ApiPilot wire contract.
// Mirrors StandardErrorSchema (C#): the error envelope, nested error
// object, and field map schemas, expressed as plain maps.

// Schema names published under components.schemas.
const (
	ErrorEnvelopeSchemaName = "ApiPilotErrorResponse"
	ErrorObjectSchemaName   = "ApiPilotError"
	ErrorFieldsSchemaName   = "ApiPilotErrorFields"
)

// ErrorEnvelopeSchema returns the error envelope schema:
// { success: false (enum), error: $ref, meta: { requestId } }.
func ErrorEnvelopeSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"success": map[string]any{
				"type":        "boolean",
				"description": "Always false for an error response.",
				"enum":        []any{false},
			},
			"error": map[string]any{
				"$ref": "#/components/schemas/" + ErrorObjectSchemaName,
			},
			"meta": map[string]any{
				"type":        "object",
				"description": "Non-business metadata.",
				"properties": map[string]any{
					"requestId": map[string]any{
						"type":        "string",
						"description": "The correlation identifier for the request.",
					},
				},
			},
		},
		"required": []any{"success", "error"},
	}
}

// ErrorObjectSchema returns the nested error object schema:
// { code, message, fields? }.
func ErrorObjectSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"code": map[string]any{
				"type":        "string",
				"description": "The stable, machine-readable error code.",
			},
			"message": map[string]any{
				"type":        "string",
				"description": "A short, safe, human-readable message.",
			},
			"fields": map[string]any{
				"$ref": "#/components/schemas/" + ErrorFieldsSchemaName,
			},
		},
		"required": []any{"code", "message"},
	}
}

// ErrorFieldsSchema returns the field map schema:
// object whose values are arrays of message strings.
func ErrorFieldsSchema() map[string]any {
	return map[string]any{
		"type":        "object",
		"description": "Field-level errors, keyed by field name.",
		"additionalProperties": map[string]any{
			"type":  "array",
			"items": map[string]any{"type": "string"},
		},
	}
}

// ErrorSchemas returns all three schemas keyed by their component names —
// ready to merge into an OpenAPI components.schemas object.
func ErrorSchemas() map[string]map[string]any {
	return map[string]map[string]any{
		ErrorEnvelopeSchemaName: ErrorEnvelopeSchema(),
		ErrorObjectSchemaName:   ErrorObjectSchema(),
		ErrorFieldsSchemaName:   ErrorFieldsSchema(),
	}
}

// Pagination schema name published under components.schemas.
const PaginationSchemaName = "ApiPilotPagination"

// PaginationSchema returns the pagination metadata schema:
// { page, pageSize, totalItems, totalPages, hasNext, hasPrevious }.
func PaginationSchema() map[string]any {
	intProp := func(desc string) map[string]any {
		return map[string]any{"type": "integer", "description": desc}
	}
	boolProp := func(desc string) map[string]any {
		return map[string]any{"type": "boolean", "description": desc}
	}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"page":         intProp("The current page number."),
			"pageSize":     intProp("The number of items per page."),
			"totalItems":   intProp("The total number of items across all pages."),
			"totalPages":   intProp("The total number of pages."),
			"hasNext":      boolProp("Whether a next page exists."),
			"hasPrevious":  boolProp("Whether a previous page exists."),
		},
		"required": []any{"page", "pageSize", "totalItems", "totalPages", "hasNext", "hasPrevious"},
	}
}

// OpenApiOptions configures the generated OpenAPI document.
// Mirrors ApiPilotOpenApiOptions (C#).
type OpenApiOptions struct {
	// DocumentPath is the route path serving the document. Default "/openapi/v1.json".
	DocumentPath string
	// DocumentTitle is the info.title. Default "ApiPilot API".
	DocumentTitle string
	// DocumentVersion is the info.version. Default "1.0.0".
	DocumentVersion string
	// IncludeErrorSchemas adds the three error schemas. Default true.
	IncludeErrorSchemas bool
	// IncludePaginationSchema adds the pagination schema. Default true.
	IncludePaginationSchema bool
}

// DefaultOpenApiOptions returns the default document options.
func DefaultOpenApiOptions() OpenApiOptions {
	return OpenApiOptions{
		DocumentPath:            "/openapi/v1.json",
		DocumentTitle:           "ApiPilot API",
		DocumentVersion:         "1.0.0",
		IncludeErrorSchemas:     true,
		IncludePaginationSchema: true,
	}
}

// OpenApiVersion is the emitted OpenAPI specification version (3.0.3).
const OpenApiVersion = "3.0.3"

// BuildOpenApiDocument builds the OpenAPI document skeleton: openapi
// version, info, empty paths, and components.schemas derived from the
// options. Mirrors ApiPilotSchemaDocument.Build (C#). Path items are the
// application's responsibility (e.g. via a router's OpenAPI integration).
func BuildOpenApiDocument(opts OpenApiOptions) map[string]any {
	schemas := map[string]any{}
	if opts.IncludeErrorSchemas {
		for name, schema := range ErrorSchemas() {
			schemas[name] = schema
		}
	}
	if opts.IncludePaginationSchema {
		schemas[PaginationSchemaName] = PaginationSchema()
	}
	return map[string]any{
		"openapi": OpenApiVersion,
		"info": map[string]any{
			"title":   opts.DocumentTitle,
			"version": opts.DocumentVersion,
		},
		"paths": map[string]any{},
		"components": map[string]any{
			"schemas": schemas,
		},
	}
}
