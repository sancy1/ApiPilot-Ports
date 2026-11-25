// filepath: src/index.ts
// layer: n/a | package: @apipilot/node | since: v0.1.0
// purpose: Public surface of @apipilot/node — generic Node http adapter.
// -----------------------------------------------------------------------------

export {
  apiPilot,
  withApiPilot,
  getPagination,
  type ApiPilotMiddleware,
  type ApiPilotNodePluginOptions,
  type NextFunction,
  type PaginationContext,
} from "./middleware.js";

export {
  resolveOptions,
  DEFAULT_ORIGIN_POLICY_OPTIONS,
  DEFAULT_CSRF_OPTIONS,
  DEFAULT_EXCEPTION_OPTIONS,
  DEFAULT_RATE_LIMIT_OPTIONS,
  DEFAULT_JSON_OPTIONS,
  type ApiPilotNodeOptions,
  type ResolvedApiPilotNodeOptions,
  type OriginPolicyOptions,
  type CsrfOptions,
  type CookieProfileOptions,
  type CookieProfilesOptions,
  type ExceptionOptions,
  type RateLimitOptions,
  type JsonOptions,
} from "./options.js";

export {
  sendSuccess,
  sendPaginated,
  sendError,
  sendValidationError,
  sendRateLimited,
  getRequestId,
  buildPagination,
  APIPILOT_REQUEST_ID,
  type ApiPagination,
} from "./results.js";

export {
  Metrics,
  DEFAULT_METRICS,
  attachMetrics,
  metricsFor,
  redactString,
  redactValue,
  DEFAULT_REDACTION_POLICY,
  type RedactionPolicy,
} from "./observability.js";

export { RateLimiter } from "./rate-limit.js";
export {
  apiPilotKoa,
  apiPilotKoaErrorHandler,
  type KoaContextLike,
  type KoaMiddleware,
} from "./koa.js";
export { diagnostics, keyRingDiagnostics, type Diagnostic } from "./diagnostics.js";
export {
  apiPilotErrorHandler,
  ApiPilotValidationException,
  type ErrorMiddleware,
  type ExceptionMapper,
  type ApiPilotErrorHandlerOptions,
} from "./exceptions.js";

export {
  errorEnvelopeSchema,
  errorObjectSchema,
  errorFieldsSchema,
  errorSchemas,
  paginationSchema,
  buildOpenApiDocument,
  OPENAPI_VERSION,
  DEFAULT_OPENAPI_OPTIONS,
  ERROR_ENVELOPE_SCHEMA_NAME,
  ERROR_OBJECT_SCHEMA_NAME,
  ERROR_FIELDS_SCHEMA_NAME,
  PAGINATION_SCHEMA_NAME,
  type OpenApiOptions,
} from "./openapi.js";
export { transformData, applyNamingPolicy, enumValue, type ApiEnumValue, type NamingPolicy } from "./serialization.js";

export {
  CsrfProtector,
  keyRingFromEnv,
  generateKeyMaterial,
  safeEqual,
  hmacSha256,
  type CsrfKeyRing,
  type CsrfProtectorOptions,
} from "./csrf/protector.js";

export {
  CsrfService,
  type CsrfServiceOptions,
  type CsrfValidationOutcome,
  type CsrfValidationResult,
} from "./csrf/service.js";

export {
  DefaultCsrfBindingResolver,
  type CsrfBindingResolver,
  type CsrfBindingResolverOptions,
  type CsrfBindingResult,
  type CsrfBindingFailureReason,
} from "./csrf/binding.js";

export {
  InMemoryRotationStore,
  CsrfTransitionListener,
  attachRotationStore,
  checkRotation,
  markRotated,
  resolveEndpointPolicy,
  type RotationStore,
  type CsrfEndpointPolicy,
} from "./csrf/extras.js";
