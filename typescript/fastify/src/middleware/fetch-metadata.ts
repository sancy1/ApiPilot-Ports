// filepath: src/middleware/fetch-metadata.ts
// layer: Middleware | package: @apipilot/fastify | since: v0.1.0
// purpose: Fetch Metadata enforcement — mirrors FetchMetadataMiddleware.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : @apipilot/core (fetch-metadata), ../results
//   Used by    : plugin.ts
//   See also   : docs/fetch-metadata.md (C# reference)
// -----------------------------------------------------------------------------

import type { FastifyReply, FastifyRequest } from "fastify";
import {
  evaluateFetchMetadata,
  ApiErrorCode,
  type FetchMetadataOptions,
} from "@apipilot/core";
import { sendError } from "../results.js";
import { metricsFor } from "../observability.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

/**
 * Fetch Metadata hook. Applies only to unsafe methods.
 * Rejection → CSRF_ORIGIN_REJECTED 403 (mirrors C# mapping).
 */
export function fetchMetadataHook(options: FetchMetadataOptions) {
  return async function fetchMetadata(request: FastifyRequest, reply: FastifyReply) {
    if (options.profile === "off") return undefined;
    if (SAFE_METHODS.has(request.method.toUpperCase())) return undefined;

    const site = request.headers["sec-fetch-site"] as string | undefined;
    const mode = request.headers["sec-fetch-mode"] as string | undefined;

    const decision = evaluateFetchMetadata(site ?? null, mode ?? null, options);
    if (decision.decision === "reject") {
      metricsFor(request).recordFetchMetadataRejected();
      await sendError(request, reply, ApiErrorCode.CsrfOriginRejected, "The request fetch metadata is not permitted.");
      return reply;
    }
    return undefined;
  };
}
