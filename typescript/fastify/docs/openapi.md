# OpenAPI

The TypeScript port ships the canonical ApiPilot error-envelope schemas for
inclusion in an OpenAPI `components.schemas` object.

## Schemas (`@apipilot/fastify`)

| Name | Schema |
| --- | --- |
| `ApiPilotErrorResponse` | `{ success: false, error: $ref, meta }` |
| `ApiPilotError` | `{ code, message, fields? }` |
| `ApiPilotErrorFields` | object → array of strings |

Individual builders: `errorEnvelopeSchema()`, `errorObjectSchema()`,
`errorFieldsSchema()`.

## Usage

```ts
import { errorSchemas } from "@apipilot/fastify";

const schemas = errorSchemas();
// merge into your OpenAPI document's components.schemas
```

The schemas describe the wire contract exactly — they are not
overridable. Path/operation generation is the application's
responsibility (Fastify's `@fastify/swagger` generates the document;
merge these schemas into `components.schemas`).
