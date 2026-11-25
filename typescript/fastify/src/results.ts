// filepath: src/results.ts
// layer: Responses | package: @apipilot/fastify | since: v0.1.0
// purpose: Reply helpers producing ApiPilot envelopes — mirrors Results/* (C#).
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : @apipilot/core (envelope), fastify
//   Used by    : route handlers, middleware error paths
//   See also   : SPEC.md#response-envelopes (C# reference)
// -----------------------------------------------------------------------------

import type { FastifyReply, FastifyRequest } from "fastify";
import {
  ApiErrorCode,
  createMeta,
  success,
  paginated,
  failure,
  validationFailure,
  buildPagination,
  type ApiMeta,
  type ApiPagination,
} from "@apipilot/core";
import { transformData } from "./serialization.js";
import type { JsonOptions } from "./options.js";

/** Symbol-keyed request decoration carrying the resolved correlation id. */
export const APIPILOT_REQUEST_ID = Symbol("apipilot.requestId");

export function getRequestId(request: FastifyRequest): string {
  const decorated = (request as unknown as Record<symbol, unknown>)[APIPILOT_REQUEST_ID];
  if (typeof decorated === "string" && decorated.length > 0) return decorated;
  return request.id;
}

function metaFor(request: FastifyRequest, extra: Record<string, unknown> = {}): ApiMeta {
  return createMeta(getRequestId(request), extra);
}

/** Resolves JsonOptions: explicit override → plugin-decorated options → defaults. */
function jsonOptionsFor(request: FastifyRequest, override?: JsonOptions): JsonOptions {
  if (override) return override;
  const apipilot = (request.server as unknown as { apipilot?: { options?: { json?: JsonOptions } } }).apipilot;
  return apipilot?.options?.json ?? { namingPolicy: "camelCase", enumMode: "string", dateMode: "iso8601" };
}

/** Sends a success envelope. `data` may be null — key always present. */
export async function sendSuccess<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  data: T,
  options: { status?: number; message?: string | null; jsonOptions?: JsonOptions } = {},
): Promise<FastifyReply> {
  const jsonOpts = jsonOptionsFor(request, options.jsonOptions);
  const transformed = transformData(data, jsonOpts);
  const envelope = success(transformed, metaFor(request), options.message ?? null);
  return reply.status(options.status ?? 200).send(envelope);
}

/** Sends a paginated envelope. */
export async function sendPaginated<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  data: T,
  pagination: ApiPagination,
  options: { status?: number; message?: string | null; jsonOptions?: JsonOptions } = {},
): Promise<FastifyReply> {
  const jsonOpts = jsonOptionsFor(request, options.jsonOptions);
  const transformed = transformData(data, jsonOpts);
  const envelope = paginated(transformed, pagination, metaFor(request), options.message ?? null);
  return reply.status(options.status ?? 200).send(envelope);
}

/** Sends an error envelope for a standard or custom code. */
export async function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  code: ApiErrorCode | string,
  message: string,
  options: { status?: number; fields?: Record<string, string[]> } = {},
): Promise<FastifyReply> {
  const resolved = typeof code === "string" ? ApiErrorCode.from(code) : code;
  const status = options.status ?? resolved.httpStatus;
  const meta = metaFor(request);
  const envelope = failure(resolved, message, meta, options.fields);
  return reply.status(status).send(envelope);
}

/** Sends a VALIDATION_ERROR envelope with field errors. */
export async function sendValidationError(
  request: FastifyRequest,
  reply: FastifyReply,
  fields: Record<string, string[]>,
  message?: string,
): Promise<FastifyReply> {
  const envelope = validationFailure(fields, metaFor(request), message);
  return reply.status(400).send(envelope);
}

/** Sends a RATE_LIMITED envelope with optional Retry-After. */
export async function sendRateLimited(
  request: FastifyRequest,
  reply: FastifyReply,
  retryAfterSeconds?: number,
): Promise<FastifyReply> {
  if (retryAfterSeconds !== undefined) {
    reply.header("Retry-After", String(Math.ceil(retryAfterSeconds)));
  }
  return sendError(request, reply, ApiErrorCode.RateLimited, "Too many requests.");
}

export { buildPagination };
export type { ApiPagination };
