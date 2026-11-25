# OpenAPI

The TypeScript port ships the canonical ApiPilot error-envelope schemas for
inclusion in an OpenAPI `components.schemas` object.

## Schemas (`@apipilot/node`)

| Name | Schema |
| --- | --- |
| `ApiPilotErrorResponse` | `{ success: false, error: $ref, meta }` |
| `ApiPilotError` | `{ code, message, fields? }` |
| `ApiPilotErrorFields` | object → array of strings |

Individual builders: `errorEnvelopeSchema()`, `errorObjectSchema()`,
`errorFieldsSchema()`.

## Usage

```ts
import { errorSchemas } from "@apipilot/node";

const schemas = errorSchemas();
// merge into your OpenAPI document's components.schemas
```

The schemas describe the wire contract exactly — they are not
overridable. Path/operation generation is the application's
responsibility.

## Serving the document

Pass `openApi` to `apiPilot()` to serve a built document (these schemas
plus `ApiPilotPagination`) at `documentPath` (default
`/openapi/v1.json`):

```ts
app.use(apiPilot({
  openApi: { documentTitle: "My API", documentVersion: "1.2.0" },
}));
```

`buildOpenApiDocument(options)` returns the document object for
assembling your own OpenAPI pipeline.
