// filepath: src/exceptions.ts
// layer: Middleware | package: @apipilot/node | since: v0.1.0
// purpose: Exception → ApiPilot error envelope mapping — mirrors
//          ApiPilotExceptionMiddleware + DefaultApiExceptionMapper (C#)
//          and middleware/exceptions.ts (@apipilot/fastify).
// -----------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiErrorCode } from "@apipilot/core";
import { sendError, sendValidationError } from "./results.js";
import { metricsFor, redactValue } from "./observability.js";
import type { ExceptionOptions } from "./options.js";
import { DEFAULT_EXCEPTION_OPTIONS } from "./options.js";

/**
 * Maps an exception to (code, message). Mirrors DefaultApiExceptionMapper's
 * ordered type checks. Applications register custom mappers via
 * `apiPilotErrorHandler({ customMappers: [...] })`.
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
  // Errors carrying an HTTP statusCode (e.g. from body parsers, routers).
  (e) => {
    const status = (e as { statusCode?: number; status?: number }).statusCode
      ?? (e as { status?: number }).status;
    if (status === 404) {
      return { code: ApiErrorCode.ResourceNotFound, message: "The requested resource was not found." };
    }
    if (status === 409) {
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

/** Express/Connect-style error middleware signature. */
export type ErrorMiddleware = (
  err: unknown,
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

export interface ApiPilotErrorHandlerOptions {
  /** Exception mapping options — reveal flags control detail leakage. */
  exceptions?: Partial<ExceptionOptions>;
  /** Custom mappers consulted before the defaults. */
  customMappers?: ExceptionMapper[];
  /** Optional logger for unhandled exceptions (receives redacted error). */
  logger?: { error: (obj: object, msg?: string) => void };
}

/**
 * Express/Connect-style error-handling middleware producing ApiPilot
 * envelopes. Register LAST in the middleware chain:
 *
 * ```ts
 * app.use(apiPilot({ ... }));
 * app.use(routes);
 * app.use(apiPilotErrorHandler());
 * ```
 *
 * Mirrors ApiPilotExceptionMiddleware: mapped exceptions → their code;
 * everything else → INTERNAL_ERROR 500 with a safe message.
 */
export function apiPilotErrorHandler(input?: ApiPilotErrorHandlerOptions): ErrorMiddleware {
  const options: ExceptionOptions = { ...DEFAULT_EXCEPTION_OPTIONS, ...input?.exceptions };
  const customMappers = input?.customMappers ?? [];
  const logger = input?.logger;

  return function apipilotErrorHandler(err, req, res, next) {
    // Field-carrying validation exception first.
    if (err instanceof ApiPilotValidationException) {
      metricsFor(req).recordValidationFailed();
      sendValidationError(req, res, err.fields, err.message);
      return;
    }

    for (const mapper of [...customMappers, ...defaultMappers]) {
      const mapped = mapper(err);
      if (mapped) {
        const message = options.revealExceptionMessage
          ? (err as Error).message || mapped.message
          : mapped.message;
        sendError(req, res, mapped.code, message);
        return;
      }
    }

    // Client errors without a specific mapping still get a sane code.
    const statusCode = (err as { statusCode?: number; status?: number }).statusCode
      ?? (err as { status?: number }).status;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      const code =
        statusCode === 404 ? ApiErrorCode.ResourceNotFound
        : statusCode === 409 ? ApiErrorCode.Conflict
        : statusCode === 406 ? ApiErrorCode.NotAcceptable
        : statusCode === 415 ? ApiErrorCode.UnsupportedMediaType
        : statusCode === 429 ? ApiErrorCode.RateLimited
        : ApiErrorCode.ValidationError;
      sendError(req, res, code, "The request could not be processed.", { status: statusCode });
      return;
    }

    logger?.error({ err: redactValue(err) }, "Unhandled exception");
    const message = options.revealExceptionMessage
      ? (err as Error).message
      : "An unexpected error occurred.";
    sendError(req, res, ApiErrorCode.InternalError, message, { status: 500 });
  };
}
