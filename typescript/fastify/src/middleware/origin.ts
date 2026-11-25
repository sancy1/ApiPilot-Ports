// filepath: src/middleware/origin.ts
// layer: Middleware | package: @apipilot/fastify | since: v0.1.0
// purpose: Origin policy enforcement — mirrors OriginMiddleware + OriginValidator.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : @apipilot/core (origin), ../results, ../options
//   Used by    : plugin.ts
//   See also   : docs/origin-policy.md (C# reference)
// -----------------------------------------------------------------------------

import type { FastifyReply, FastifyRequest } from "fastify";
import { originMatches, ApiErrorCode } from "@apipilot/core";
import { sendError } from "../results.js";
import { metricsFor } from "../observability.js";
import type { OriginPolicyOptions } from "../options.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

/**
 * Origin policy hook. Applies only to unsafe methods (POST/PUT/PATCH/DELETE).
 * Mirrors OriginMiddleware: Origin header → Referer fallback → fail-closed.
 */
export function originHook(options: OriginPolicyOptions) {
  return async function origin(request: FastifyRequest, reply: FastifyReply) {
    if (!options.enabled) return undefined;
    if (SAFE_METHODS.has(request.method.toUpperCase())) return undefined;

    const originHeader = request.headers["origin"] as string | undefined;
    const refererHeader = request.headers["referer"] as string | undefined;

    let candidate: string | null = null;
    if (originHeader !== undefined && originHeader !== "") {
      candidate = originHeader;
    } else if (options.allowRefererFallback && refererHeader !== undefined && refererHeader !== "") {
      // Referer fallback: extract origin part (scheme://host[:port]).
      candidate = extractOriginFromReferer(refererHeader);
    }

    if (candidate === null) {
      if (options.requireOriginHeader) {
        metricsFor(request).recordOriginRejected();
        await sendError(request, reply, ApiErrorCode.CsrfOriginRejected, "The request origin could not be verified.");
        return reply;
      }
      return undefined;
    }

    const allowed = options.allowedOrigins.some((allowedOrigin) =>
      originMatches(candidate!, allowedOrigin, options.matchMode),
    );

    if (!allowed) {
      metricsFor(request).recordOriginRejected();
      await sendError(request, reply, ApiErrorCode.CsrfOriginRejected, "The request origin is not permitted.");
      return reply;
    }

    return undefined;
  };
}

/** Extracts `scheme://host[:port]` from a Referer URL; null when unparseable. */
function extractOriginFromReferer(referer: string): string | null {
  try {
    const url = new URL(referer);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}
