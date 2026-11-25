# ApiPilot Node.js API reference

Public surface of `@apipilot/node` (see `src/index.ts`).

## Middleware

| Export | Signature | Purpose |
| --- | --- | --- |
| `apiPilot` | `(options?: ApiPilotNodePluginOptions) => ApiPilotMiddleware` | Full pipeline middleware `(req, res, next)`. |
| `withApiPilot` | `(handler, options?) => ApiPilotMiddleware` | Wraps a raw handler with the pipeline. |
| `getPagination` | `(req) => PaginationContext \| null` | Parsed pagination/sort/filter stored by the middleware. |
| `apiPilotErrorHandler` | `(options?) => ErrorMiddleware` | Express/Connect error middleware → ApiPilot envelopes. |
| `ApiPilotValidationException` | `class` | Thrown to produce `VALIDATION_ERROR` with `fields`. |

## Options

| Export | Purpose |
| --- | --- |
| `resolveOptions` | Merge user options with defaults → `ResolvedApiPilotNodeOptions`. |
| `ApiPilotNodeOptions` / `ResolvedApiPilotNodeOptions` | Option types (correlation, rateLimit, contentNegotiation, origin, fetchMetadata, cookies, csrf, pagination, metrics, exceptions). |
| `ApiPilotNodePluginOptions` | `ApiPilotNodeOptions` + `csrfKeyRing`, `csrfBinding`, `openApi`. |
| `DEFAULT_*_OPTIONS` | Defaults for origin, CSRF, exceptions, rate limit, JSON. |
| `JsonOptions` | `namingPolicy`, `enumMode`, `dateMode`, `dictionaryKeyPolicy`, `ignoreNulls`. |

## Responses

| Export | Signature |
| --- | --- |
| `sendSuccess` | `(req, res, data, { status?, message?, jsonOptions? })` |
| `sendPaginated` | `(req, res, data, pagination, { status?, message?, jsonOptions? })` |
| `sendError` | `(req, res, code, message, { status?, fields?, headers? })` |
| `sendValidationError` | `(req, res, fields, message?)` |
| `sendRateLimited` | `(req, res, retryAfterSeconds?)` |
| `getRequestId` | `(req) => string` |
| `buildPagination` | `(totalItems, page, pageSize) => ApiPagination` (re-exported from core) |
| `APIPILOT_REQUEST_ID` | Symbol key for the resolved correlation ID. |

## Observability

| Export | Purpose |
| --- | --- |
| `Metrics` / `DEFAULT_METRICS` | In-memory counters (`snapshot()`). |
| `attachMetrics` / `metricsFor` | Request-scoped metrics access. |
| `redactString` / `redactValue` / `DEFAULT_REDACTION_POLICY` | Log redaction. |
| `diagnostics` / `keyRingDiagnostics` / `Diagnostic` | Startup configuration warnings. |

## Rate limiting

| Export | Purpose |
| --- | --- |
| `RateLimiter` | Fixed-window limiter used by the middleware. |

## OpenAPI

| Export | Purpose |
| --- | --- |
| `buildOpenApiDocument` | Document skeleton (info, paths, components.schemas). |
| `errorSchemas` / `errorEnvelopeSchema` / `errorObjectSchema` / `errorFieldsSchema` | Error component schemas. |
| `paginationSchema` | `ApiPilotPagination` component schema. |
| `OPENAPI_VERSION`, `DEFAULT_OPENAPI_OPTIONS`, `OpenApiOptions` | Constants/types. |
| `ERROR_*_SCHEMA_NAME`, `PAGINATION_SCHEMA_NAME` | Schema name constants. |

## Serialization

| Export | Purpose |
| --- | --- |
| `transformData` | Apply `JsonOptions` to a payload. |
| `applyNamingPolicy` / `enumValue` / `NamingPolicy` / `ApiEnumValue` | Naming/enum helpers. |

## CSRF

| Export | Purpose |
| --- | --- |
| `CsrfProtector` | AES-256-GCM protect/unprotect (`v1.<keyId>.<iv>.<ct>.<tag>`). |
| `CsrfKeyRing` | `{ activeKeyId, keys: Record<string, Buffer> }`. |
| `keyRingFromEnv` | Build ring from `APIPILOT_CSRF_KEYS` + `APIPILOT_CSRF_ACTIVE_KEY`. |
| `generateKeyMaterial` | Fresh 32-byte base64 key. |
| `safeEqual` / `hmacSha256` | Crypto helpers. |
| `CsrfService` | Issue/validate tokens (`CsrfValidationOutcome`). |
| `DefaultCsrfBindingResolver` / `CsrfBindingResolver` | Subject → session → preauth binding. |
| `InMemoryRotationStore` / `RotationStore` | Rotation marker store. |
| `CsrfTransitionListener` | Login/logout token refresh hooks. |
| `attachRotationStore` / `checkRotation` / `markRotated` | Rotation store wiring. |
| `resolveEndpointPolicy` | require > skip > useGlobal precedence. |
