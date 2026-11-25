// filepath: src/middleware.ts
// layer: Middleware | package: @apipilot/node | since: v0.1.0
// purpose: ApiPilot pipeline as Connect/Express-style middleware over
//          node:http — works with Express, Hono, NestJS (Express), polka,
//          and raw Node http. Mirrors the Fastify plugin pipeline order:
//          correlation → rate-limit → content-negotiation → origin →
//          fetch-metadata → csrf bootstrap/validation → pagination.
// -----------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiErrorCode } from "@apipilot/core";
import {
  resolveCorrelationId,
  generateGuidV7,
  evaluateContentNegotiation,
  evaluateFetchMetadata,
  originMatches,
  parsePaginationQuery,
} from "@apipilot/core";
import {
  resolveOptions,
  type ApiPilotNodeOptions,
  type ResolvedApiPilotNodeOptions,
} from "./options.js";
import {
  sendError,
  sendSuccess,
  sendValidationError,
  APIPILOT_REQUEST_ID,
} from "./results.js";
import { attachMetrics, metricsFor } from "./observability.js";
import { RateLimiter } from "./rate-limit.js";
import { CsrfProtector, keyRingFromEnv, type CsrfKeyRing } from "./csrf/protector.js";
import { CsrfService } from "./csrf/service.js";
import {
  DefaultCsrfBindingResolver,
  type CsrfBindingResolver,
  type CsrfBindingResolverOptions,
} from "./csrf/binding.js";
import { attachRotationStore, markRotated } from "./csrf/extras.js";
import { buildOpenApiDocument, DEFAULT_OPENAPI_OPTIONS, type OpenApiOptions } from "./openapi.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

/** Connect/Express-style next callback. */
export type NextFunction = (err?: unknown) => void;

/** Connect/Express-style middleware signature over node:http. */
export type ApiPilotMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: NextFunction,
) => void;

export interface ApiPilotNodePluginOptions extends ApiPilotNodeOptions {
  /** CSRF key ring. When omitted and csrf.enabled, keyRingFromEnv() is used. */
  csrfKeyRing?: CsrfKeyRing;
  /** CSRF binding resolver configuration. */
  csrfBinding?: CsrfBindingResolverOptions;
  /** When set, serves the OpenAPI document at documentPath (default
   *  "/openapi/v1.json") as raw JSON. Mirrors ApiPilotOpenApiOptions (C#). */
  openApi?: OpenApiOptions;
}

interface CsrfDeps {
  service: CsrfService;
  bindingResolver: CsrfBindingResolver;
  options: ResolvedApiPilotNodeOptions["csrf"];
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

function requestPath(req: IncomingMessage): string {
  return (req.url ?? "").split("?")[0] ?? "";
}

function clientIp(req: IncomingMessage): string {
  const fwd = header(req, "x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "anonymous";
}

function parseQuery(req: IncomingMessage): Record<string, string | string[] | undefined> {
  const url = req.url ?? "";
  const qIndex = url.indexOf("?");
  if (qIndex < 0) return {};
  const params = new URLSearchParams(url.slice(qIndex + 1));
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of params) {
    const existing = out[k];
    if (existing === undefined) out[k] = v;
    else if (Array.isArray(existing)) existing.push(v);
    else out[k] = [existing, v];
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
 * Creates the ApiPilot middleware. Pipeline order mirrors the C#/Fastify
 * adapters: correlation → rate-limit → content-negotiation → origin →
 * fetch-metadata → CSRF bootstrap/validation → pagination → next().
 *
 * @example Express
 * ```ts
 * import express from "express";
 * import { apiPilot } from "@apipilot/node";
 * const app = express();
 * app.use(apiPilot({ csrf: { enabled: true } }));
 * ```
 *
 * @example Raw Node http
 * ```ts
 * import { createServer } from "node:http";
 * import { apiPilot, withApiPilot } from "@apipilot/node";
 * createServer(withApiPilot((req, res) => { /* ... *\/ }, { csrf: { enabled: true } }));
 * ```
 */
export function apiPilot(input?: ApiPilotNodePluginOptions): ApiPilotMiddleware {
  const options = resolveOptions(input);

  // --- CSRF wiring (only when enabled) ---
  let csrfDeps: CsrfDeps | undefined;
  if (options.csrf.enabled) {
    if (options.csrf.rotationRequirement === "required" && !options.csrf.rotationStore) {
      throw new Error("csrf.rotationRequirement='required' but no rotationStore configured");
    }
    const keyRing = input?.csrfKeyRing ?? keyRingFromEnv();
    const protector = new CsrfProtector(keyRing);
    const bindingResolver = new DefaultCsrfBindingResolver(input?.csrfBinding ?? {});
    const service = new CsrfService(protector, bindingResolver, {
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

  // OpenAPI document (built once at registration).
  const openApiDoc = input?.openApi !== undefined
    ? buildOpenApiDocument(input.openApi)
    : null;
  const openApiPath = input?.openApi?.documentPath ?? DEFAULT_OPENAPI_OPTIONS.documentPath;

  return function apipilotMiddleware(req, res, next) {
    const method = (req.method ?? "GET").toUpperCase();
    const path = requestPath(req);

    attachMetrics(req, options.metrics);

    // --- 0. OpenAPI document endpoint (GET only, raw JSON) ---
    if (openApiDoc !== null && method === "GET" && path === openApiPath) {
      const payload = JSON.stringify(openApiDoc);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload),
        "cache-control": "no-store",
      });
      res.end(payload);
      return;
    }

    // --- 1. Correlation ---
    const corrOpts = options.correlation;
    const headerValue = header(req, corrOpts.headerName);
    const patternMatches = headerValue !== undefined && corrOpts.validationPattern.test(headerValue);
    const decision = resolveCorrelationId(headerValue ?? null, corrOpts, patternMatches);
    if (decision.kind === "reject") {
      sendError(req, res, ApiErrorCode.ValidationError, "The correlation ID header is invalid.", { status: 400 });
      return;
    }
    const requestId = decision.kind === "use-incoming" ? decision.id : generateGuidV7();
    (req as unknown as Record<symbol, unknown>)[APIPILOT_REQUEST_ID] = requestId;
    if (corrOpts.echoInResponseHeader) {
      res.setHeader(corrOpts.headerName, requestId);
    }

    // --- 1b. Rate limiting ---
    if (rateLimiter !== null) {
      const keyFn = options.rateLimit.keyExtractor
        ? options.rateLimit.keyExtractor({ ip: clientIp(req) })
        : clientIp(req);
      const { allowed, retryAfterSeconds } = rateLimiter.allow(keyFn);
      if (!allowed) {
        metricsFor(req).recordRateLimited();
        const headers = options.rateLimit.setRetryAfterHeader && retryAfterSeconds > 0
          ? { "retry-after": String(retryAfterSeconds) }
          : undefined;
        sendError(req, res, ApiErrorCode.RateLimited, options.rateLimit.message,
          headers === undefined ? {} : { headers });
        return;
      }
    }

    // --- 2. Content negotiation ---
    const accept = header(req, "accept");
    const contentType = header(req, "content-type");
    const cn = evaluateContentNegotiation(accept ?? null, contentType ?? null, method, options.contentNegotiation);
    if (cn.status === 406) {
      metricsFor(req).recordValidationFailed();
      sendError(req, res, ApiErrorCode.NotAcceptable, "The requested media type is not supported.");
      return;
    }
    if (cn.status === 415) {
      metricsFor(req).recordValidationFailed();
      const message = !contentType
        ? "A Content-Type header is required for this request."
        : "The request content type is not supported.";
      sendError(req, res, ApiErrorCode.UnsupportedMediaType, message);
      return;
    }

    // --- 3. Origin policy (unsafe methods only) ---
    if (!SAFE_METHODS.has(method) && options.origin.enabled) {
      const originHeader = header(req, "origin");
      const refererHeader = header(req, "referer");
      let candidate: string | null = null;
      if (originHeader) {
        candidate = originHeader;
      } else if (options.origin.allowRefererFallback && refererHeader) {
        candidate = extractOriginFromReferer(refererHeader);
      }
      if (candidate === null) {
        if (options.origin.requireOriginHeader) {
          metricsFor(req).recordOriginRejected();
          sendError(req, res, ApiErrorCode.CsrfOriginRejected, "The request origin could not be verified.");
          return;
        }
      } else {
        const allowed = options.origin.allowedOrigins.some((ao) =>
          originMatches(candidate!, ao, options.origin.matchMode),
        );
        if (!allowed) {
          metricsFor(req).recordOriginRejected();
          sendError(req, res, ApiErrorCode.CsrfOriginRejected, "The request origin is not permitted.");
          return;
        }
      }
    }

    // --- 4. Fetch metadata (unsafe methods only) ---
    if (!SAFE_METHODS.has(method) && options.fetchMetadata.profile !== "off") {
      const site = header(req, "sec-fetch-site");
      const mode = header(req, "sec-fetch-mode");
      const fm = evaluateFetchMetadata(site ?? null, mode ?? null, options.fetchMetadata);
      if (fm.decision === "reject") {
        metricsFor(req).recordFetchMetadataRejected();
        sendError(req, res, ApiErrorCode.CsrfOriginRejected, "The request fetch metadata is not permitted.");
        return;
      }
    }

    // --- 5. CSRF bootstrap endpoint (GET only) ---
    if (csrfDeps !== undefined && method === "GET" && path === csrfDeps.options.bootstrapPath) {
      handleBootstrap(req, res, csrfDeps, requestId);
      return;
    }

    // --- 6. CSRF validation (unsafe methods only; bootstrap path exempt) ---
    if (
      csrfDeps !== undefined &&
      !SAFE_METHODS.has(method) &&
      path !== csrfDeps.options.bootstrapPath &&
      csrfDeps.options.protectedMethods.map((m) => m.toUpperCase()).includes(method)
    ) {
      if (!checkCsrf(req, res, csrfDeps, requestId)) return;
    }

    // --- 7. Pagination (parse + validate; store on request) ---
    if (input?.paginationEnabled === true) {
      const parsed = parsePaginationQuery(parseQuery(req), options.pagination);
      if (Object.keys(parsed.errors).length > 0) {
        metricsFor(req).recordValidationFailed();
        sendValidationError(req, res, parsed.errors);
        return;
      }
      (req as unknown as Record<symbol, unknown>)[PAGINATION_KEY] = {
        pageRequest: parsed.pageRequest,
        sort: parsed.sort,
        filter: parsed.filter,
      };
    }

    next();
  };
}

const PAGINATION_KEY = Symbol("apipilot.pagination");

/** Pagination context stored on the request by the middleware. */
export interface PaginationContext {
  pageRequest: { page: number; pageSize: number };
  sort: { field: string; direction: "asc" | "desc" } | null;
  filter: { parameters: Record<string, string> } | null;
}

/** Retrieves the parsed pagination context stored by the middleware. */
export function getPagination(req: IncomingMessage): PaginationContext | null {
  const ctx = (req as unknown as Record<symbol, unknown>)[PAGINATION_KEY];
  return (ctx as PaginationContext | undefined) ?? null;
}

function handleBootstrap(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CsrfDeps,
  requestId: string,
): void {
  const binding = deps.bindingResolver.resolve(req);
  if (binding === null) {
    sendError(req, res, ApiErrorCode.CsrfTokenInvalid, "The CSRF token could not be issued.");
    return;
  }
  const token = deps.service.issueToken(binding.source, binding.kind);
  metricsFor(req).recordCsrfIssued();
  // Rotation policy: onBootstrap/onWindow record a marker so previously
  // issued tokens validate as rotated; never skips.
  if (deps.options.rotationPolicy !== "never") {
    markRotated(deps.service, binding.fingerprint);
  }
  res.setHeader("cache-control", "no-store");
  sendSuccess(req, res, { token }, { message: null });
}

function checkCsrf(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CsrfDeps,
  requestId: string,
): boolean {
  const token = header(req, deps.options.headerName);
  const binding = deps.bindingResolver.resolve(req);

  if (binding === null) {
    metricsFor(req).recordCsrfRejected();
    sendError(req, res, ApiErrorCode.CsrfTokenInvalid, "The CSRF token could not be validated.");
    return false;
  }

  const result = deps.service.validateToken(token ?? null, binding.fingerprint);
  switch (result.outcome) {
    case "valid":
      metricsFor(req).recordCsrfValidated();
      return true;
    case "expired":
      metricsFor(req).recordCsrfExpired();
      sendError(req, res, ApiErrorCode.CsrfTokenExpired, "The CSRF token has expired.");
      return false;
    case "missingToken":
      metricsFor(req).recordCsrfRejected();
      sendError(req, res, ApiErrorCode.CsrfHeaderMissing, "The CSRF token header is missing.");
      return false;
    default:
      metricsFor(req).recordCsrfRejected();
      sendError(req, res, ApiErrorCode.CsrfTokenInvalid, "The CSRF token is invalid.");
      return false;
  }
}

/**
 * Wraps a raw Node request handler with the ApiPilot middleware —
 * for use without a Connect/Express-style framework.
 *
 * @example
 * ```ts
 * import { createServer } from "node:http";
 * import { withApiPilot } from "@apipilot/node";
 *
 * createServer(withApiPilot((req, res) => {
 *   res.end(JSON.stringify({ ok: true }));
 * }, { csrf: { enabled: true } }));
 * ```
 */
export function withApiPilot(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  options?: ApiPilotNodePluginOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const mw = apiPilot(options);
  return (req, res) => {
    mw(req, res, () => handler(req, res));
  };
}
