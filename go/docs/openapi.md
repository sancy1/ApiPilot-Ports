# OpenAPI

The Go port ships the canonical ApiPilot error-envelope schemas for
inclusion in an OpenAPI `components.schemas` object.

## Schemas (`httpapi.ErrorSchemas()`)

| Name | Schema |
| --- | --- |
| `ApiPilotErrorResponse` | `{ success: false, error: $ref, meta }` |
| `ApiPilotError` | `{ code, message, fields? }` |
| `ApiPilotErrorFields` | object → array of strings |

Individual builders: `ErrorEnvelopeSchema()`, `ErrorObjectSchema()`,
`ErrorFieldsSchema()`.

## Usage

```go
schemas := httpapi.ErrorSchemas()
// merge into your OpenAPI document's components.schemas
```

The schemas describe the wire contract exactly — they are not
overridable. Path/operation generation is the application's
responsibility (the C# port uses ASP.NET ApiExplorer; the ports leave
document generation to the host framework's OpenAPI tooling).
