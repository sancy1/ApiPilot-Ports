// filepath: src/index.ts
// layer: n/a | package: @apipilot/hono | since: v0.1.0
// purpose: Public surface of @apipilot/hono — Hono middleware implementing
//          the full ApiPilot pipeline over the web Request/Response model.
// -----------------------------------------------------------------------------

import type { Context, MiddlewareHandler, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  ApiErrorCode,
  buildPagination,
  createMeta,
  csrfBindingFingerprint,
  evaluateContentNegotiation,
  evaluateFetchMetadata,
  failure,
  generateGuidV7,
  originMatches,
  paginated,
  parsePaginationQuery,
  resolveCorrelationId,
  success,
  validationFailure,
  type ApiErrorEnvelope,
  type ApiMeta,
  type ApiPagination,
  type ApiSuccessEnvelope,
  type ParsedPaginationQuery,
} from "@apipilot/core";
import {
  ApiPilotValidationException,
  attachRotationStore,
  buildOpenApiDocument,
  CsrfProtector,
  CsrfService,
  DEFAULT_METRICS,
  DEFAULT_OPENAPI_OPTIONS,
  keyRingFromEnv,
  markRotated,
  RateLimiter,
  resolveOptions,
  type ApiPilotErrorHandlerOptions,
  type ApiPilotNodePluginOptions,
  type CsrfKeyRing,
  type ExceptionMapper,
  type Metrics,
  type OpenApiOptions,
  type ResolvedApiPilotNodeOptions,
} from "@apipilot/node";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Extractor signatures receive the Hono context. */
export interface HonoCsrfBindingResolverOptions {
  subjectExtractor?: (c: Context) => string | null;
  sessionExtractor?: (c: Context) => string | null;
  preAuthSource?: (c: Context) => string | null;
}

export interface HonoCsrfBindingResult {
  fingerprint: string;
  /** The raw source string (never logged). */
  source: string;
  kind: "subject" | "session" | "preauth";
}

/** Resolves the CSRF binding for a Hono request — subject → session → preauth. */
export class HonoCsrfBindingResolver {
  constructor(private readonly options: HonoCsrfBindingResolverOptions = {}) {}

  resolve(c: Context): HonoCsrfBindingResult | null {
    const subject = this.options.subjectExtractor?.(c) ?? null;
    if (subject !== null && subject !== "") {
      return {
        fingerprint: csrfBindingFingerprint(subject, "subject"),
        source: subject,
        kind: "subject",
      };
    }
    const sessionId = this.options.sessionExtractor?.(c) ?? null;
    if (sessionId !== null && sessionId !== "") {
      return {
        fingerprint: csrfBindingFingerprint(sessionId, "session"),
        source: sessionId,
        kind: "session",
      };
    }
    const preAuth = this.options.preAuthSource?.(c) ?? null;
    if (preAuth !== null && preAuth !== "") {
      return {
        fingerprint: csrfBindingFingerprint(preAuth, "preauth"),
        source: preAuth,
        kind: "preauth",
      };
    }
    return null;
  }
}

export interface ApiPilotHonoPluginOptions
  extends Omit<ApiPilotNodePluginOptions, "csrfBinding"> {
  /** CSRF binding resolver configuration (Hono context extractors). */
  csrfBinding?: HonoCsrfBindingResolverOptions;
}

// ---------------------------------------------------------------------------
// Per-request state (WeakMap keyed by Context — no global leakage)
// ---------------------------------------------------------------------------

interface RequestState {
  requestId: string;
  metrics: Metrics;
  pagination: PaginationContext | null;
}

const stateMap = new WeakMap<Context, RequestState>();

/** Correlation request id for the current Hono context. */
export function getRequestId(c: Context): string | null {
  return stateMap.get(c)?.requestId ?? null;
}

/** Pipeline metrics for the current Hono context. */
export function getMetrics(c: Context): Metrics | null {
  return stateMap.get(c)?.metrics ?? null;
}

/** Pagination context stored by the middleware (null when disabled/absent). */
export interface PaginationContext {
  pageRequest: { page: number; pageSize: number };
  sort: { field: string; direction: "asc" | "desc" } | null;
  filter: { parameters: Record<string, string> } | null;
}

/** Retrieves the parsed pagination context for the current context. */
export function getPagination(c: Context): PaginationContext | null {
  return stateMap.get(c)?.pagination ?? null;
}

// ---------------------------------------------------------------------------
// Response helpers (Hono equivalents of results.ts)
// ---------------------------------------------------------------------------

function meta(c: Context): ApiMeta {
  return createMeta(getRequestId(c) ?? "");
}

/** c.json with a numeric status cast to Hono's literal-union type. */
function json<T>(c: Context, body: T, status: number): Response {
  return c.json(body, status as ContentfulStatusCode);
}

/** Sends a success envelope. */
export function sendSuccess<T>(
  c: Context,
  data: T,
  options: { status?: number; message?: string | null } = {},
): Response {
  const body: ApiSuccessEnvelope<T> = success(data, meta(c), options.message ?? null);
  return json(c, body, options.status ?? 200);
}

/** Sends a paginated envelope. */
export function sendPaginated<T>(
  c: Context,
  data: T,
  pagination: ApiPagination,
  options: { status?: number; message?: string | null } = {},
): Response {
  const body = paginated(data, pagination, meta(c), options.message ?? null);
  return json(c, body, options.status ?? 200);
}

function resolveCode(code: ApiErrorCode | string): ApiErrorCode {
  return typeof code === "string" ? ApiErrorCode.from(code) : code;
}

/** Sends an error envelope for a standard or custom code. */
export function sendError(
  c: Context,
  code: ApiErrorCode | string,
  message: string,
  options: { status?: number; fields?: Record<string, string[]> } = {},
): Response {
  const resolved = resolveCode(code);
  const status = options.status ?? resolved.httpStatus;
  const body: ApiErrorEnvelope = failure(resolved, message, meta(c), options.fields);
  return json(c, body, status);
}

/** Sends a VALIDATION_ERROR envelope with field errors. */
export function sendValidationError(
  c: Context,
  fields: Record<string, string[]>,
  message?: string,
): Response {
  const body: ApiErrorEnvelope = validationFailure(fields, meta(c), message);
  return json(c, body, 400);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

interface CsrfDeps {
  service: CsrfService;
  bindingResolver: HonoCsrfBindingResolver;
  options: ResolvedApiPilotNodeOptions["csrf"];
}

function header(c: Context, name: string): string | undefined {
  return c.req.header(name);
}

function clientIp(c: Context): string {
  const fwd = header(c, "x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  // @hono/node-server exposes the Node request on c.env.incoming.
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? "anonymous";
}

function parseQuery(c: Context): Record<string, string | string[] | undefined> {
  const queries = c.req.queries();
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(queries)) {
    if (v === undefined) continue;
    out[k] = v.length === 1 ? v[0] : v;
  }
  return out;
}

function extractOriginFromReferer(referer: string): string | null {
  try {
    const url = new URL(referer);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Creates the ApiPilot Hono middleware. Pipeline order mirrors the
 * Connect/Express adapter: correlation → rate-limit → content-negotiation
 * → origin → fetch-metadata → CSRF bootstrap/validation → pagination →
 * next() with exception mapping.
 *
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { serve } from "@hono/node-server";
 * import { apiPilotHono, sendSuccess } from "@apipilot/hono";
 *
 * const app = new Hono();
 * app.use(apiPilotHono({ csrf: { enabled: true } }));
 * app.get("/health", (c) => sendSuccess(c, { status: "ok" }));
 * serve(app);
 * ```
 */
export function apiPilotHono(input?: ApiPilotHonoPluginOptions): MiddlewareHandler {
  const options = resolveOptions(input as unknown as ApiPilotNodePluginOptions);

  // --- CSRF wiring (only when enabled) ---
  let csrfDeps: CsrfDeps | undefined;
  if (options.csrf.enabled) {
    if (options.csrf.rotationRequirement === "required" && !options.csrf.rotationStore) {
      throw new Error("csrf.rotationRequirement='required' but no rotationStore configured");
    }
    const keyRing: CsrfKeyRing = input?.csrfKeyRing ?? keyRingFromEnv();
    const protector = new CsrfProtector(keyRing);
    const bindingResolver = new HonoCsrfBindingResolver(input?.csrfBinding ?? {});
    const service = new CsrfService(protector, bindingResolver as never, {
      tokenLifetimeSeconds: options.csrf.tokenLifetimeSeconds,
      tokenEntropyBytes: options.csrf.tokenEntropyBytes,
    });
    if (options.csrf.rotationStore) {
      attachRotationStore(service, options.csrf.rotationStore);
    }
    csrfDeps = { service, bindingResolver, options: options.csrf };
  }

  const rateLimiter = options.rateLimit.enabled
    ? new RateLimiter(options.rateLimit)
    : null;

  const openApiDoc = input?.openApi !== undefined
    ? buildOpenApiDocument(input.openApi)
    : null;
  const openApiPath = input?.openApi?.documentPath ?? DEFAULT_OPENAPI_OPTIONS.documentPath;

  return async function apipilotHono(c: Context, next: Next) {
    const method = c.req.method.toUpperCase();
    const path = c.req.path;

    // --- 1. Correlation ---
    const corrOpts = options.correlation;
    const headerValue = header(c, corrOpts.headerName);
    const patternMatches = headerValue !== undefined && corrOpts.validationPattern.test(headerValue);
    const decision = resolveCorrelationId(headerValue ?? null, corrOpts, patternMatches);
    if (decision.kind === "reject") {
      return json(
        c,
        failure(ApiErrorCode.ValidationError, "The correlation ID header is invalid.", createMeta("")),
        400,
      );
    }
    const requestId = decision.kind === "use-incoming" ? decision.id : generateGuidV7();
    const metrics = options.metrics ?? DEFAULT_METRICS;
    stateMap.set(c, { requestId, metrics, pagination: null });
    if (corrOpts.echoInResponseHeader) {
      c.header(corrOpts.headerName, requestId);
    }

    // --- 0. OpenAPI document endpoint (GET only) ---
    if (openApiDoc !== null && method === "GET" && path === openApiPath) {
      c.header("cache-control", "no-store");
      return json(c, openApiDoc, 200);
    }

    // --- 1b. Rate limiting ---
    if (rateLimiter !== null) {
      const keyFn = options.rateLimit.keyExtractor
        ? options.rateLimit.keyExtractor({ ip: clientIp(c) })
        : clientIp(c);
      const { allowed, retryAfterSeconds } = rateLimiter.allow(keyFn);
      if (!allowed) {
        metrics.recordRateLimited();
        if (options.rateLimit.setRetryAfterHeader && retryAfterSeconds > 0) {
          c.header("retry-after", String(retryAfterSeconds));
        }
        return sendError(c, ApiErrorCode.RateLimited, options.rateLimit.message);
      }
    }

    // --- 2. Content negotiation ---
    const accept = header(c, "accept");
    const contentType = header(c, "content-type");
    const cn = evaluateContentNegotiation(accept ?? null, contentType ?? null, method, options.contentNegotiation);
    if (cn.status === 406) {
      metrics.recordValidationFailed();
      return sendError(c, ApiErrorCode.NotAcceptable, "The requested media type is not supported.");
    }
    if (cn.status === 415) {
      metrics.recordValidationFailed();
      const message = !contentType
        ? "A Content-Type header is required for this request."
        : "The request content type is not supported.";
      return sendError(c, ApiErrorCode.UnsupportedMediaType, message);
    }

    // --- 3. Origin policy (unsafe methods only) ---
    if (!SAFE_METHODS.has(method) && options.origin.enabled) {
      const originHeader = header(c, "origin");
      const refererHeader = header(c, "referer");
      let candidate: string | null = null;
      if (originHeader) {
        candidate = originHeader;
      } else if (options.origin.allowRefererFallback && refererHeader) {
        candidate = extractOriginFromReferer(refererHeader);
      }
      if (candidate === null) {
        if (options.origin.requireOriginHeader) {
          metrics.recordOriginRejected();
          return sendError(c, ApiErrorCode.CsrfOriginRejected, "The request origin could not be verified.");
        }
      } else {
        const allowed = options.origin.allowedOrigins.some((ao) =>
          originMatches(candidate!, ao, options.origin.matchMode),
        );
        if (!allowed) {
          metrics.recordOriginRejected();
          return sendError(c, ApiErrorCode.CsrfOriginRejected, "The request origin is not permitted.");
        }
      }
    }

    // --- 4. Fetch metadata (unsafe methods only) ---
    if (!SAFE_METHODS.has(method) && options.fetchMetadata.profile !== "off") {
      const site = header(c, "sec-fetch-site");
      const mode = header(c, "sec-fetch-mode");
      const fm = evaluateFetchMetadata(site ?? null, mode ?? null, options.fetchMetadata);
      if (fm.decision === "reject") {
        metrics.recordFetchMetadataRejected();
        return sendError(c, ApiErrorCode.CsrfOriginRejected, "The request fetch metadata is not permitted.");
      }
    }

    // --- 5. CSRF bootstrap endpoint (GET only) ---
    if (csrfDeps !== undefined && method === "GET" && path === csrfDeps.options.bootstrapPath) {
      const binding = csrfDeps.bindingResolver.resolve(c);
      if (binding === null) {
        return sendError(c, ApiErrorCode.CsrfTokenInvalid, "The CSRF token could not be issued.");
      }
      const token = csrfDeps.service.issueToken(binding.source, binding.kind);
      metrics.recordCsrfIssued();
      if (csrfDeps.options.rotationPolicy !== "never") {
        markRotated(csrfDeps.service, binding.fingerprint);
      }
      c.header("cache-control", "no-store");
      return sendSuccess(c, { token });
    }

    // --- 6. CSRF validation (unsafe methods only; bootstrap path exempt) ---
    if (
      csrfDeps !== undefined &&
      !SAFE_METHODS.has(method) &&
      path !== csrfDeps.options.bootstrapPath &&
      csrfDeps.options.protectedMethods.map((m) => m.toUpperCase()).includes(method)
    ) {
      const token = header(c, csrfDeps.options.headerName);
      const binding = csrfDeps.bindingResolver.resolve(c);
      if (binding === null) {
        metrics.recordCsrfRejected();
        return sendError(c, ApiErrorCode.CsrfTokenInvalid, "The CSRF token could not be validated.");
      }
      const result = csrfDeps.service.validateToken(token ?? null, binding.fingerprint);
      if (result.outcome !== "valid") {
        if (result.outcome === "expired") {
          metrics.recordCsrfExpired();
          return sendError(c, ApiErrorCode.CsrfTokenExpired, "The CSRF token has expired.");
        }
        if (result.outcome === "missingToken") {
          metrics.recordCsrfRejected();
          return sendError(c, ApiErrorCode.CsrfHeaderMissing, "The CSRF token header is missing.");
        }
        metrics.recordCsrfRejected();
        return sendError(c, ApiErrorCode.CsrfTokenInvalid, "The CSRF token is invalid.");
      }
      metrics.recordCsrfValidated();
    }

    // --- 7. Pagination (parse + validate; store on context) ---
    if (input?.paginationEnabled === true) {
      const parsed: ParsedPaginationQuery = parsePaginationQuery(parseQuery(c), options.pagination);
      if (Object.keys(parsed.errors).length > 0) {
        metrics.recordValidationFailed();
        return sendValidationError(c, parsed.errors);
      }
      const state = stateMap.get(c);
      if (state) {
        state.pagination = {
          pageRequest: parsed.pageRequest,
          sort: parsed.sort,
          filter: parsed.filter,
        };
      }
    }

    // --- 8. Downstream ---
    // NOTE: Hono's compose catches handler errors at the dispatch level and
    // routes them to app.onError — middleware try/catch cannot intercept
    // them. Register apiPilotHonoErrorHandler() via app.onError() for
    // exception mapping (the try/catch remains for non-Error throws).
    try {
      return await next();
    } catch (err) {
      return mapException(c, err, options, []);
    }
  };
}

// ---------------------------------------------------------------------------
// Exception mapping (mirrors apiPilotErrorHandler defaults)
// ---------------------------------------------------------------------------

function mapException(
  c: Context,
  err: unknown,
  options: ResolvedApiPilotNodeOptions,
  customMappers: ExceptionMapper[],
): Response {
  const metrics = stateMap.get(c)?.metrics ?? DEFAULT_METRICS;

  if (err instanceof ApiPilotValidationException) {
    metrics.recordValidationFailed();
    return sendValidationError(c, err.fields, err.message);
  }

  for (const mapper of customMappers) {
    const mapped = mapper(err);
    if (mapped) {
      const message = options.exceptions.revealExceptionMessage && err instanceof Error
        ? err.message || mapped.message
        : mapped.message;
      return sendError(c, mapped.code, message);
    }
  }

  // HTTPException-style errors (Hono HTTPException, generic status carriers).
  const carrier = err as { status?: unknown; statusCode?: unknown } | null;
  const statusCode = carrier?.status ?? carrier?.statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    const code = statusCode === 404
      ? ApiErrorCode.ResourceNotFound
      : statusCode === 409
        ? ApiErrorCode.Conflict
        : ApiErrorCode.ValidationError;
    return sendError(c, code, "The request could not be processed.", { status: statusCode });
  }

  const message = options.exceptions.revealExceptionMessage && err instanceof Error
    ? err.message
    : "An unexpected error occurred.";
  return sendError(c, ApiErrorCode.InternalError, message);
}

/**
 * Hono `app.onError` handler producing ApiPilot envelopes — the Hono
 * equivalent of `apiPilotErrorHandler` (Connect) / exception middleware
 * (C#). Register LAST:
 *
 * ```ts
 * const app = new Hono();
 * app.use(apiPilotHono({ ... }));
 * app.onError(apiPilotHonoErrorHandler());
 * ```
 *
 * Hono routes handler errors to `onError` at the dispatch level, so this
 * is the only reliable place to map exceptions to envelopes.
 */
export function apiPilotHonoErrorHandler(
  input?: ApiPilotErrorHandlerOptions,
): (err: Error, c: Context) => Response | Promise<Response> {
  const options = resolveOptions({ exceptions: input?.exceptions } as ApiPilotNodePluginOptions);
  const customMappers = input?.customMappers ?? [];
  const logger = input?.logger;
  return function apipilotHonoErrorHandler(err: Error, c: Context) {
    if (logger) {
      logger.error({ err: err?.message ?? String(err) }, "unhandled exception");
    }
    return mapException(c, err, options, customMappers);
  };
}

/** Builds a paginated envelope from total/page/pageSize for the context. */
export function paginatedResponse<T>(
  c: Context,
  data: T,
  totalItems: number,
  page: number,
  pageSize: number,
): Response {
  return sendPaginated(c, data, buildPagination(totalItems, page, pageSize));
}
