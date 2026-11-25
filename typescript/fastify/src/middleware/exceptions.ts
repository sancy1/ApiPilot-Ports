// filepath: src/middleware/exceptions.ts
// layer: Middleware | package: @apipilot/fastify | since: v0.1.0
// purpose: Exception → ApiPilot error envelope mapping — mirrors ApiPilotExceptionMiddleware + DefaultApiExceptionMapper.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : @apipilot/core (error-codes), ../results, ../options
//   Used by    : plugin.ts (setErrorHandler)
//   See also   : docs/error-contract.md, docs/exception-handling.md (C# reference)
// -----------------------------------------------------------------------------

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ApiErrorCode } from "@apipilot/core";
import { sendError } from "../results.js";
import { redactValue } from "../observability.js";
import type { ExceptionOptions } from "../options.js";

/**
 * Maps an exception to (code, message). Mirrors DefaultApiExceptionMapper's
 * ordered type checks. Applications register custom mappers via
 * `addExceptionMapping` on the plugin.
 */
export type ExceptionMapper = (error: unknown) => { code: ApiErrorCode | string; message: string } | null;

const defaultMappers: ExceptionMapper[] = [
  // Validation errors thrown by adapters.
  (e) => {
    if (e instanceof ApiPilotValidationException) {
      return { code: ApiErrorCode.ValidationError, message: e.message };
    }
    return null;
  },
  // Fastify's own validation errors (schema validation).
  (e) => {
    const fe = e as FastifyError;
    if (fe?.statusCode === 400 && fe.validation) {
      return { code: ApiErrorCode.ValidationError, message: "One or more values are invalid." };
    }
    return null;
  },
  // Not found.
  (e) => {
    const fe = e as FastifyError;
    if (fe?.statusCode === 404) {
      return { code: ApiErrorCode.ResourceNotFound, message: "The requested resource was not found." };
    }
    return null;
  },
  // Conflict.
  (e) => {
    const fe = e as FastifyError;
    if (fe?.statusCode === 409) {
      return { code: ApiErrorCode.Conflict, message: "The request conflicts with the current state." };
    }
    return null;
  },
];

/** Thrown by adapter validation helpers; carries field errors. */
export class ApiPilotValidationException extends Error {
  constructor(
    message: string,
    public readonly fields: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiPilotValidationException";
  }
}

export interface ExceptionHandlerDeps {
  options: ExceptionOptions;
  customMappers: ExceptionMapper[];
  logger?: { error: (obj: object, msg?: string) => void } | undefined;
}

/**
 * Fastify error handler producing ApiPilot envelopes. Registered via
 * fastify.setErrorHandler. Mirrors ApiPilotExceptionMiddleware:
 * mapped exceptions → their code; everything else → INTERNAL_ERROR 500
 * with a safe message (reveal flags control detail leakage).
 */
export function createExceptionHandler(deps: ExceptionHandlerDeps) {
  return async function errorHandler(
    error: FastifyError | Error,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    // Field-carrying validation exception first.
    if (error instanceof ApiPilotValidationException) {
      const { sendValidationError } = await import("../results.js");
      const { metricsFor } = await import("../observability.js");
      metricsFor(request).recordValidationFailed();
      return sendValidationError(request, reply, error.fields, error.message);
    }

    for (const mapper of [...deps.customMappers, ...defaultMappers]) {
      const mapped = mapper(error);
      if (mapped) {
        const message = deps.options.revealExceptionMessage
          ? (error as Error).message || mapped.message
          : mapped.message;
        return sendError(request, reply, mapped.code, message);
      }
    }

    // Client errors without a specific mapping still get a sane code.
    const statusCode = (error as FastifyError).statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      const code =
        statusCode === 404 ? ApiErrorCode.ResourceNotFound
        : statusCode === 409 ? ApiErrorCode.Conflict
        : statusCode === 406 ? ApiErrorCode.NotAcceptable
        : statusCode === 415 ? ApiErrorCode.UnsupportedMediaType
        : statusCode === 429 ? ApiErrorCode.RateLimited
        : ApiErrorCode.ValidationError;
      return sendError(request, reply, code, "The request could not be processed.", { status: statusCode });
    }

    deps.logger?.error({ err: redactValue(error) }, "Unhandled exception");
    const message = deps.options.revealExceptionMessage
      ? (error as Error).message
      : "An unexpected error occurred.";
    return sendError(request, reply, ApiErrorCode.InternalError, message, { status: 500 });
  };
}
