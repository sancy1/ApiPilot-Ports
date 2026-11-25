// filepath: src/index.ts
// layer: n/a | package: @apipilot/fastify | since: v0.1.0
// purpose: Public surface of @apipilot/fastify — the Fastify adapter for ApiPilot.
// -----------------------------------------------------------------------------

export { apipilotPlugin, default } from "./plugin.js";
export type { ApiPilotPluginOptions } from "./plugin.js";

export {
  resolveOptions,
  DEFAULT_ORIGIN_POLICY_OPTIONS,
  DEFAULT_CSRF_OPTIONS,
  DEFAULT_EXCEPTION_OPTIONS,
  DEFAULT_RATE_LIMIT_OPTIONS,
  DEFAULT_JSON_OPTIONS,
} from "./options.js";
export type {
  ApiPilotOptions,
  ResolvedApiPilotOptions,
  OriginPolicyOptions,
  CsrfOptions,
  CookieProfileOptions,
  CookieProfilesOptions,
  ExceptionOptions,
  RateLimitOptions,
  JsonOptions,
} from "./options.js";

export {
  sendSuccess,
  sendPaginated,
  sendError,
  sendValidationError,
  sendRateLimited,
  getRequestId,
  buildPagination,
} from "./results.js";
export type { ApiPagination } from "./results.js";

export { paginationHook, getPagination } from "./pagination.js";
export type { PaginationContext } from "./pagination.js";

export { transformData, applyNamingPolicy, enumValue } from "./serialization.js";
export type { ApiEnumValue, NamingPolicy } from "./serialization.js";

export { CsrfProtector, keyRingFromEnv, generateKeyMaterial, safeEqual, hmacSha256 } from "./csrf/protector.js";
export type { CsrfKeyRing, CsrfProtectorOptions } from "./csrf/protector.js";
export { CsrfService } from "./csrf/service.js";
export type { CsrfServiceOptions, CsrfValidationResult, CsrfValidationOutcome } from "./csrf/service.js";
export { DefaultCsrfBindingResolver } from "./csrf/binding.js";
export type { CsrfBindingResolver, CsrfBindingResolverOptions, CsrfBindingResult } from "./csrf/binding.js";
export {
  InMemoryRotationStore,
  attachRotationStore,
  checkRotation,
  markRotated,
  CsrfTransitionListener,
  resolveEndpointPolicy,
} from "./csrf/extras.js";
export type { CsrfEndpointPolicy, RotationStore } from "./csrf/extras.js";

export { ApiPilotValidationException, type ExceptionMapper } from "./middleware/exceptions.js";
export { APIPILOT_SKIP_CSRF, APIPILOT_REQUIRE_CSRF } from "./middleware/csrf.js";
export { RateLimiter, rateLimitHook } from "./middleware/rate-limit.js";
export { diagnostics, keyRingDiagnostics } from "./diagnostics.js";
export type { Diagnostic } from "./diagnostics.js";
export { Metrics, DEFAULT_METRICS, metricsFor, redactString, redactValue, DEFAULT_REDACTION_POLICY } from "./observability.js";
export type { RedactionPolicy } from "./observability.js";
export {
  ERROR_ENVELOPE_SCHEMA_NAME,
  ERROR_OBJECT_SCHEMA_NAME,
  ERROR_FIELDS_SCHEMA_NAME,
  PAGINATION_SCHEMA_NAME,
  OPENAPI_VERSION,
  DEFAULT_OPENAPI_OPTIONS,
  errorEnvelopeSchema,
  errorObjectSchema,
  errorFieldsSchema,
  errorSchemas,
  paginationSchema,
  buildOpenApiDocument,
} from "./openapi.js";
export type { OpenApiOptions } from "./openapi.js";

// Re-export core for adapter consumers convenience.
export * as core from "@apipilot/core";
