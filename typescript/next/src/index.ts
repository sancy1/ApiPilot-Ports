// filepath: src/index.ts
// layer: n/a | package: @apipilot/next | since: v0.1.0
// purpose: Public surface of @apipilot/next — Next.js adapter covering both
//          routers: App Router route handlers (web Request/Response) and
//          Pages Router API routes (via the node adapter).
// -----------------------------------------------------------------------------

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
  withApiPilot as withApiPilotPages,
  type ApiPilotErrorHandlerOptions,
  type ApiPilotNodePluginOptions,
  type ApiPilotNodeOptions,
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

/** Extractor signatures receive the web Request. */
export interface NextCsrfBindingResolverOptions {
  subjectExtractor?: (req: Request) => string | null;
  sessionExtractor?: (req: Request) => string | null;
  preAuthSource?: (req: Request) => string | null;
}

export interface NextCsrfBindingResult {
  fingerprint: string;
  /** The raw source string (never logged). */
  source: string;
  kind: "subject" | "session" | "preauth";
}

/** Resolves the CSRF binding for a request — subject → session → preauth. */
export class NextCsrfBindingResolver {
  constructor(private readonly options: NextCsrfBindingResolverOptions = {}) {}

  resolve(req: Request): NextCsrfBindingResult | null {
    const subject = this.options.subjectExtractor?.(req) ?? null;
    if (subject !== null && subject !== "") {
      return {
        fingerprint: csrfBindingFingerprint(subject, "subject"),
        source: subject,
        kind: "subject",
      };
    }
    const sessionId = this.options.sessionExtractor?.(req) ?? null;
    if (sessionId !== null && sessionId !== "") {
      return {
        fingerprint: csrfBindingFingerprint(sessionId, "session"),
        source: sessionId,
        kind: "session",
      };
    }
    const preAuth = this.options.preAuthSource?.(req) ?? null;
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

export interface ApiPilotNextPluginOptions
  extends Omit<ApiPilotNodePluginOptions, "csrfBinding"> {
  /** CSRF binding resolver configuration (Request extractors). */
  csrfBinding?: NextCsrfBindingResolverOptions;
}

// ---------------------------------------------------------------------------
// Per-request state (WeakMap keyed by Request — no global leakage)
// ---------------------------------------------------------------------------

interface RequestState {
  requestId: string;
  metrics: Metrics;
  pagination: PaginationContext | null;
  responseHeaders: Record<string, string>;
}

const stateMap = new WeakMap<Request, RequestState>();

/** Correlation request id for the current Request. */
export function getRequestId(req: Request): string | null {
  return stateMap.get(req)?.requestId ?? null;
}

/** Pipeline metrics for the current Request. */
export function getMetrics(req: Request): Metrics | null {
  return stateMap.get(req)?.metrics ?? null;
}

/** Pagination context stored by the middleware (null when disabled/absent). */
export interface PaginationContext {
  pageRequest: { page: number; pageSize: number };
  sort: { field: string; direction: "asc" | "desc" } | null;
  filter: { parameters: Record<string, string> } | null;
}

/** Retrieves the parsed pagination context for the current request. */
export function getPagination(req: Request): PaginationContext | null {
  return stateMap.get(req)?.pagination ?? null;
}

// ---------------------------------------------------------------------------
// Response helpers (web Response equivalents of results.ts)
// ---------------------------------------------------------------------------

function meta(req: Request): ApiMeta {
  return createMeta(getRequestId(req) ?? "");
}

function json<T>(body: T, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

/** Builds a success envelope Response. */
export function apiSuccess<T>(
  data: T,
  req: Request,
  options: { status?: number; message?: string | null } = {},
): Response {
  const body: ApiSuccessEnvelope<T> = success(data, meta(req), options.message ?? null);
  return json(body, options.status ?? 200);
}

/** Builds a paginated envelope Response. */
export function apiPaginated<T>(
  data: T,
  pagination: ApiPagination,
  req: Request,
  options: { status?: number; message?: string | null } = {},
): Response {
  const body = paginated(data, pagination, meta(req), options.message ?? null);
  return json(body, options.status ?? 200);
}

/** Builds a paginated envelope from total/page/pageSize. */
export function apiPaginatedResponse<T>(
  data: T,
  totalItems: number,
  page: number,
  pageSize: number,
  req: Request,
): Response {
  return apiPaginated(data, buildPagination(totalItems, page, pageSize), req);
}

function resolveCode(code: ApiErrorCode | string): ApiErrorCode {
  return typeof code === "string" ? ApiErrorCode.from(code) : code;
}

/** Builds an error envelope Response. */
export function apiError(
  code: ApiErrorCode | string,
  message: string,
  req: Request,
  options: { status?: number; fields?: Record<string, string[]>; headers?: Record<string, string> } = {},
): Response {
  const resolved = resolveCode(code);
  const status = options.status ?? resolved.httpStatus;
  const body: ApiErrorEnvelope = failure(resolved, message, meta(req), options.fields);
  return json(body, status, options.headers);
}

/** Builds a VALIDATION_ERROR envelope Response. */
export function apiValidationError(
  fields: Record<string, string[]>,
  req: Request,
  message?: string,
): Response {
  const body: ApiErrorEnvelope = validationFailure(fields, meta(req), message);
  return json(body, 400);
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

interface CsrfDeps {
  service: CsrfService;
  bindingResolver: NextCsrfBindingResolver;
  options: ResolvedApiPilotNodeOptions["csrf"];
}

interface Pipeline {
  options: ResolvedApiPilotNodeOptions;
  csrfDeps: CsrfDeps | undefined;
  rateLimiter: RateLimiter | null;
  openApiDoc: unknown | null;
  openApiPath: string;
}

function buildPipeline(input?: ApiPilotNextPluginOptions): Pipeline {
  const options = resolveOptions(input as unknown as ApiPilotNodePluginOptions);

  let csrfDeps: CsrfDeps | undefined;
  if (options.csrf.enabled) {
    if (options.csrf.rotationRequirement === "required" && !options.csrf.rotationStore) {
      throw new Error("csrf.rotationRequirement='required' but no rotationStore configured");
    }
    const keyRing: CsrfKeyRing = input?.csrfKeyRing ?? keyRingFromEnv();
    const protector = new CsrfProtector(keyRing);
    const bindingResolver = new NextCsrfBindingResolver(input?.csrfBinding ?? {});
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

  return { options, csrfDeps, rateLimiter, openApiDoc, openApiPath };
}

function requestPath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return req.url.split("?")[0] ?? "";
  }
}

function parseQuery(req: Request): Record<string, string | string[] | undefined> {
  try {
    const params = new URL(req.url).searchParams;
    const out: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of params) {
      const existing = out[k];
      if (existing === undefined) out[k] = v;
      else if (Array.isArray(existing)) existing.push(v);
      else out[k] = [existing, v];
    }
    return out;
  } catch {
    return {};
  }
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "anonymous";
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
 * Runs the ApiPilot pipeline for an App Router request.
 * Returns a Response when the pipeline rejects/short-circuits,
 * or null when the handler should run.
 */
async function runPipeline(
  req: Request,
  pipeline: Pipeline,
  input: ApiPilotNextPluginOptions | undefined,
): Promise<Response | null> {
  const { options, csrfDeps, rateLimiter, openApiDoc, openApiPath } = pipeline;
  const method = req.method.toUpperCase();
  const path = requestPath(req);

  // --- 1. Correlation ---
  const corrOpts = options.correlation;
  const headerValue = req.headers.get(corrOpts.headerName) ?? undefined;
  const patternMatches = headerValue !== undefined && corrOpts.validationPattern.test(headerValue);
  const decision = resolveCorrelationId(headerValue ?? null, corrOpts, patternMatches);
  if (decision.kind === "reject") {
    return json(
      failure(ApiErrorCode.ValidationError, "The correlation ID header is invalid.", createMeta("")),
      400,
    );
  }
  const requestId = decision.kind === "use-incoming" ? decision.id : generateGuidV7();
  const metrics = options.metrics ?? DEFAULT_METRICS;
  const responseHeaders: Record<string, string> = {};
  if (corrOpts.echoInResponseHeader) {
    responseHeaders[corrOpts.headerName] = requestId;
  }
  stateMap.set(req, { requestId, metrics, pagination: null, responseHeaders });

  // --- 0. OpenAPI document endpoint (GET only) ---
  if (openApiDoc !== null && method === "GET" && path === openApiPath) {
    return json(openApiDoc, 200, { ...responseHeaders, "cache-control": "no-store" });
  }

  // --- 1b. Rate limiting ---
  if (rateLimiter !== null) {
    const keyFn = options.rateLimit.keyExtractor
      ? options.rateLimit.keyExtractor({ ip: clientIp(req) })
      : clientIp(req);
    const { allowed, retryAfterSeconds } = rateLimiter.allow(keyFn);
    if (!allowed) {
      metrics.recordRateLimited();
      const headers = { ...responseHeaders };
      if (options.rateLimit.setRetryAfterHeader && retryAfterSeconds > 0) {
        headers["retry-after"] = String(retryAfterSeconds);
      }
      return apiError(ApiErrorCode.RateLimited, options.rateLimit.message, req, { headers });
    }
  }

  // --- 2. Content negotiation ---
  const accept = req.headers.get("accept") ?? undefined;
  const contentType = req.headers.get("content-type") ?? undefined;
  const cn = evaluateContentNegotiation(accept ?? null, contentType ?? null, method, options.contentNegotiation);
  if (cn.status === 406) {
    metrics.recordValidationFailed();
    return apiError(ApiErrorCode.NotAcceptable, "The requested media type is not supported.", req, { headers: responseHeaders });
  }
  if (cn.status === 415) {
    metrics.recordValidationFailed();
    const message = !contentType
      ? "A Content-Type header is required for this request."
      : "The request content type is not supported.";
    return apiError(ApiErrorCode.UnsupportedMediaType, message, req, { headers: responseHeaders });
  }

  // --- 3. Origin policy (unsafe methods only) ---
  if (!SAFE_METHODS.has(method) && options.origin.enabled) {
    const originHeader = req.headers.get("origin") ?? undefined;
    const refererHeader = req.headers.get("referer") ?? undefined;
    let candidate: string | null = null;
    if (originHeader) {
      candidate = originHeader;
    } else if (options.origin.allowRefererFallback && refererHeader) {
      candidate = extractOriginFromReferer(refererHeader);
    }
    if (candidate === null) {
      if (options.origin.requireOriginHeader) {
        metrics.recordOriginRejected();
        return apiError(ApiErrorCode.CsrfOriginRejected, "The request origin could not be verified.", req, { headers: responseHeaders });
      }
    } else {
      const allowed = options.origin.allowedOrigins.some((ao) =>
        originMatches(candidate!, ao, options.origin.matchMode),
      );
      if (!allowed) {
        metrics.recordOriginRejected();
        return apiError(ApiErrorCode.CsrfOriginRejected, "The request origin is not permitted.", req, { headers: responseHeaders });
      }
    }
  }

  // --- 4. Fetch metadata (unsafe methods only) ---
  if (!SAFE_METHODS.has(method) && options.fetchMetadata.profile !== "off") {
    const site = req.headers.get("sec-fetch-site") ?? undefined;
    const mode = req.headers.get("sec-fetch-mode") ?? undefined;
    const fm = evaluateFetchMetadata(site ?? null, mode ?? null, options.fetchMetadata);
    if (fm.decision === "reject") {
      metrics.recordFetchMetadataRejected();
      return apiError(ApiErrorCode.CsrfOriginRejected, "The request fetch metadata is not permitted.", req, { headers: responseHeaders });
    }
  }

  // --- 5. CSRF bootstrap endpoint (GET only) ---
  if (csrfDeps !== undefined && method === "GET" && path === csrfDeps.options.bootstrapPath) {
    const binding = csrfDeps.bindingResolver.resolve(req);
    if (binding === null) {
      return apiError(ApiErrorCode.CsrfTokenInvalid, "The CSRF token could not be issued.", req, { headers: responseHeaders });
    }
    const token = csrfDeps.service.issueToken(binding.source, binding.kind);
    metrics.recordCsrfIssued();
    if (csrfDeps.options.rotationPolicy !== "never") {
      markRotated(csrfDeps.service, binding.fingerprint);
    }
    return json(
      success({ token }, meta(req)),
      200,
      { ...responseHeaders, "cache-control": "no-store" },
    );
  }

  // --- 6. CSRF validation (unsafe methods only; bootstrap path exempt) ---
  if (
    csrfDeps !== undefined &&
    !SAFE_METHODS.has(method) &&
    path !== csrfDeps.options.bootstrapPath &&
    csrfDeps.options.protectedMethods.map((m) => m.toUpperCase()).includes(method)
  ) {
    const token = req.headers.get(csrfDeps.options.headerName) ?? undefined;
    const binding = csrfDeps.bindingResolver.resolve(req);
    if (binding === null) {
      metrics.recordCsrfRejected();
      return apiError(ApiErrorCode.CsrfTokenInvalid, "The CSRF token could not be validated.", req, { headers: responseHeaders });
    }
    const result = csrfDeps.service.validateToken(token ?? null, binding.fingerprint);
    if (result.outcome !== "valid") {
      if (result.outcome === "expired") {
        metrics.recordCsrfExpired();
        return apiError(ApiErrorCode.CsrfTokenExpired, "The CSRF token has expired.", req, { headers: responseHeaders });
      }
      if (result.outcome === "missingToken") {
        metrics.recordCsrfRejected();
        return apiError(ApiErrorCode.CsrfHeaderMissing, "The CSRF token header is missing.", req, { headers: responseHeaders });
      }
      metrics.recordCsrfRejected();
      return apiError(ApiErrorCode.CsrfTokenInvalid, "The CSRF token is invalid.", req, { headers: responseHeaders });
    }
    metrics.recordCsrfValidated();
  }

  // --- 7. Pagination (parse + validate; store on request) ---
  if (input?.paginationEnabled === true) {
    const parsed: ParsedPaginationQuery = parsePaginationQuery(parseQuery(req), options.pagination);
    if (Object.keys(parsed.errors).length > 0) {
      metrics.recordValidationFailed();
      return apiValidationError(parsed.errors, req);
    }
    const state = stateMap.get(req);
    if (state) {
      state.pagination = {
        pageRequest: parsed.pageRequest,
        sort: parsed.sort,
        filter: parsed.filter,
      };
    }
  }

  return null; // pass through to handler
}

/** Merges pipeline response headers (e.g. correlation id) into a Response. */
function mergeResponseHeaders(res: Response, extra: Record<string, string>): Response {
  const keys = Object.keys(extra);
  if (keys.length === 0) return res;
  const headers = new Headers(res.headers);
  for (const k of keys) {
    if (!headers.has(k)) headers.set(k, extra[k]!);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function stateHeaders(req: Request): Record<string, string> {
  return stateMap.get(req)?.responseHeaders ?? {};
}

// ---------------------------------------------------------------------------
// Exception mapping
// ---------------------------------------------------------------------------

function mapException(
  req: Request,
  err: unknown,
  options: ResolvedApiPilotNodeOptions,
  customMappers: ExceptionMapper[],
): Response {
  const metrics = stateMap.get(req)?.metrics ?? DEFAULT_METRICS;

  if (err instanceof ApiPilotValidationException) {
    metrics.recordValidationFailed();
    return apiValidationError(err.fields, req, err.message);
  }

  for (const mapper of customMappers) {
    const mapped = mapper(err);
    if (mapped) {
      const message = options.exceptions.revealExceptionMessage && err instanceof Error
        ? err.message || mapped.message
        : mapped.message;
      return apiError(mapped.code, message, req);
    }
  }

  const carrier = err as { status?: unknown; statusCode?: unknown } | null;
  const statusCode = carrier?.status ?? carrier?.statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    const code = statusCode === 404
      ? ApiErrorCode.ResourceNotFound
      : statusCode === 409
        ? ApiErrorCode.Conflict
        : ApiErrorCode.ValidationError;
    return apiError(code, "The request could not be processed.", req, { status: statusCode });
  }

  const message = options.exceptions.revealExceptionMessage && err instanceof Error
    ? err.message
    : "An unexpected error occurred.";
  return apiError(ApiErrorCode.InternalError, message, req);
}

// ---------------------------------------------------------------------------
// Public wrappers
// ---------------------------------------------------------------------------

/** App Router route handler signature. */
export type AppRouteHandler = (req: Request) => Response | Promise<Response>;

/**
 * Wraps an App Router route handler with the full ApiPilot pipeline.
 *
 * ```ts
 * // app/api/items/route.ts
 * import { withApiPilot, apiSuccess } from "@apipilot/next";
 *
 * export const GET = withApiPilot(async (req) => {
 *   return apiSuccess({ items: [] }, req);
 * });
 * ```
 *
 * Pipeline rejections return envelope Responses directly; handler
 * exceptions are mapped to envelopes (equivalent of apiPilotErrorHandler).
 */
export function withApiPilot(
  handler: AppRouteHandler,
  input?: ApiPilotNextPluginOptions & { customMappers?: ExceptionMapper[] },
): AppRouteHandler {
  const pipeline = buildPipeline(input);
  const customMappers = input?.customMappers ?? [];
  return async function apipilotNextHandler(req: Request): Promise<Response> {
    const rejection = await runPipeline(req, pipeline, input);
    if (rejection !== null) return rejection;
    try {
      const res = await handler(req);
      return mergeResponseHeaders(res, stateHeaders(req));
    } catch (err) {
      return mergeResponseHeaders(
        mapException(req, err, pipeline.options, customMappers),
        stateHeaders(req),
      );
    }
  };
}

/**
 * Pages Router wrapper — re-export of the node adapter's `withApiPilot`,
 * which already accepts NextApiRequest/NextApiResponse (they extend
 * IncomingMessage/ServerResponse).
 *
 * ```ts
 * // pages/api/items.ts
 * import { withApiPilotPages, sendSuccess } from "@apipilot/next";
 *
 * export default withApiPilotPages(async (req, res) => {
 *   sendSuccess(req, res, { items: [] });
 * }, { csrf: { enabled: true } });
 * ```
 */
export { withApiPilotPages };

/**
 * Error-handler options type shared with the node adapter — kept for
 * API symmetry with `apiPilotErrorHandler` / `apiPilotHonoErrorHandler`.
 */
export type { ApiPilotErrorHandlerOptions, ApiPilotNodeOptions, OpenApiOptions };
