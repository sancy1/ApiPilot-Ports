// filepath: src/middleware/csrf.ts
// layer: Middleware | package: @apipilot/fastify | since: v0.1.0
// purpose: CSRF enforcement + bootstrap endpoint — mirrors CsrfMiddleware + CsrfBootstrapEndpoint.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : ../csrf/service, ../csrf/binding, ../results, ../options, @apipilot/core
//   Used by    : plugin.ts
//   See also   : docs/csrf.md (C# reference)
// -----------------------------------------------------------------------------

import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiErrorCode } from "@apipilot/core";
import { sendError, sendSuccess } from "../results.js";
import { metricsFor } from "../observability.js";
import type { CsrfService } from "../csrf/service.js";
import type { CsrfBindingResolver } from "../csrf/binding.js";
import type { CsrfOptions } from "../options.js";
import { markRotated } from "../csrf/extras.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

/** Per-request skip flag set by decorators/metadata. */
export const APIPILOT_SKIP_CSRF = Symbol("apipilot.skipCsrf");
export const APIPILOT_REQUIRE_CSRF = Symbol("apipilot.requireCsrf");

export interface CsrfMiddlewareDeps {
  service: CsrfService;
  bindingResolver: CsrfBindingResolver;
  options: CsrfOptions;
}

/**
 * CSRF validation hook for unsafe methods. Mirrors CsrfMiddleware:
 *   header missing → CSRF_HEADER_MISSING 403
 *   binding unresolvable → fail closed CSRF_TOKEN_INVALID 403
 *   invalid signature/malformed/binding mismatch → CSRF_TOKEN_INVALID 403
 *   expired → CSRF_TOKEN_EXPIRED 403
 */
export function csrfHook(deps: CsrfMiddlewareDeps) {
  return async function csrf(request: FastifyRequest, reply: FastifyReply) {
    const { options, service, bindingResolver } = deps;

    const method = request.method.toUpperCase();
    if (SAFE_METHODS.has(method)) return undefined;
    if (!options.protectedMethods.map((m) => m.toUpperCase()).includes(method)) return undefined;

    // Bootstrap path is exempt from CSRF validation on every method.
    const path = (request.raw.url ?? "").split("?")[0];
    if (path === options.bootstrapPath) return undefined;

    // Per-route skip/require flags.
    const flags = request.routeOptions?.config as unknown as Record<symbol, unknown> | undefined;
    if (flags?.[APIPILOT_SKIP_CSRF] === true) return undefined;

    const headerValue = request.headers[options.headerName.toLowerCase()] as string | undefined;
    if (headerValue === undefined || headerValue === "") {
      metricsFor(request).recordCsrfRejected();
      await sendError(request, reply, ApiErrorCode.CsrfHeaderMissing, "The CSRF token header is missing.");
      return reply;
    }

    const binding = bindingResolver.resolve(request);
    if (binding === null) {
      // Fail closed — never issue or accept anonymous bindings.
      metricsFor(request).recordCsrfRejected();
      await sendError(request, reply, ApiErrorCode.CsrfTokenInvalid, "The CSRF token could not be validated.");
      return reply;
    }

    const result = service.validateToken(headerValue, binding.fingerprint);
    switch (result.outcome) {
      case "valid":
        metricsFor(request).recordCsrfValidated();
        return undefined;
      case "expired":
        metricsFor(request).recordCsrfExpired();
        await sendError(request, reply, ApiErrorCode.CsrfTokenExpired, "The CSRF token has expired.");
        return reply;
      case "missingToken":
        metricsFor(request).recordCsrfRejected();
        await sendError(request, reply, ApiErrorCode.CsrfHeaderMissing, "The CSRF token header is missing.");
        return reply;
      default:
        metricsFor(request).recordCsrfRejected();
        await sendError(request, reply, ApiErrorCode.CsrfTokenInvalid, "The CSRF token is invalid.");
        return reply;
    }
  };
}

/**
 * Registers the CSRF bootstrap endpoint: GET {bootstrapPath} → { token }.
 * Response is Cache-Control: no-store. Requires a resolvable binding —
 * returns 403 when none exists (fail closed).
 */
export function registerCsrfBootstrap(
  fastify: { get: (path: string, handler: (req: FastifyRequest, rep: FastifyReply) => unknown) => unknown },
  deps: CsrfMiddlewareDeps,
): void {
  const { options, service, bindingResolver } = deps;

  fastify.get(options.bootstrapPath, async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");

    const binding = bindingResolver.resolve(request);
    if (binding === null) {
      await sendError(request, reply, ApiErrorCode.CsrfTokenInvalid, "The CSRF token could not be issued.");
      return reply;
    }

    const token = service.issueToken(binding.source, binding.kind);
    metricsFor(request).recordCsrfIssued();
    // Rotation policy: onBootstrap/onWindow record a marker so previously
    // issued tokens for this binding validate as rotated; never skips.
    if (options.rotationPolicy !== "never") {
      markRotated(service, binding.fingerprint);
    }
    return sendSuccess(request, reply, { token }, { message: null });
  });
}
