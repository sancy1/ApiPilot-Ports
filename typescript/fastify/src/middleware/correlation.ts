// filepath: src/middleware/correlation.ts
// layer: Middleware | package: @apipilot/fastify | since: v0.1.0
// purpose: Correlation ID resolution — mirrors CorrelationMiddleware (C#).
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : @apipilot/core (correlation), ../results
//   Used by    : plugin.ts
//   See also   : docs/correlation.md (C# reference)
// -----------------------------------------------------------------------------

import type { FastifyReply, FastifyRequest } from "fastify";
import {
  resolveCorrelationId,
  generateGuidV7,
  type CorrelationOptions,
} from "@apipilot/core";
import { APIPILOT_REQUEST_ID, sendError } from "../results.js";
import { ApiErrorCode } from "@apipilot/core";

export function correlationHook(options: CorrelationOptions) {
  return async function correlation(request: FastifyRequest, reply: FastifyReply) {
    const headerValue = request.headers[options.headerName.toLowerCase()] as string | undefined;
    const patternMatches = headerValue !== undefined && options.validationPattern.test(headerValue);

    const decision = resolveCorrelationId(headerValue ?? null, options, patternMatches);

    if (decision.kind === "reject") {
      await sendError(request, reply, ApiErrorCode.ValidationError, "The correlation ID header is invalid.", {
        status: 400,
      });
      return reply;
    }

    const requestId = decision.kind === "use-incoming" ? decision.id : generateGuidV7();
    (request as unknown as Record<symbol, unknown>)[APIPILOT_REQUEST_ID] = requestId;

    if (options.echoInResponseHeader) {
      reply.header(options.headerName, requestId);
    }

    return undefined;
  };
}
