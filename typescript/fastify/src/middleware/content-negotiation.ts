// filepath: src/middleware/content-negotiation.ts
// layer: Middleware | package: @apipilot/fastify | since: v0.1.0
// purpose: Accept/Content-Type enforcement — mirrors ApiPilotContentNegotiationMiddleware.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : @apipilot/core (content-negotiation), ../results
//   Used by    : plugin.ts
//   See also   : docs/content-negotiation.md (C# reference)
// -----------------------------------------------------------------------------

import type { FastifyReply, FastifyRequest } from "fastify";
import {
  evaluateContentNegotiation,
  ApiErrorCode,
  type ContentNegotiationOptions,
} from "@apipilot/core";
import { sendError } from "../results.js";

export function contentNegotiationHook(options: ContentNegotiationOptions) {
  return async function contentNegotiation(request: FastifyRequest, reply: FastifyReply) {
    const accept = request.headers["accept"] as string | undefined;
    const contentType = request.headers["content-type"] as string | undefined;

    const decision = evaluateContentNegotiation(
      accept ?? null,
      contentType ?? null,
      request.method,
      options,
    );

    if (decision.status === 406) {
      await sendError(request, reply, ApiErrorCode.NotAcceptable, "The requested media type is not supported.");
      return reply;
    }
    if (decision.status === 415) {
      const message = contentType === undefined || contentType === ""
        ? "A Content-Type header is required for this request."
        : "The request content type is not supported.";
      await sendError(request, reply, ApiErrorCode.UnsupportedMediaType, message);
      return reply;
    }
    return undefined;
  };
}
