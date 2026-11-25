// filepath: src/results.ts
// layer: Responses | package: @apipilot/node | since: v0.1.0
// purpose: Response helpers producing ApiPilot envelopes over node:http —
//          mirrors Results/* (C#) and results.ts (@apipilot/fastify).
// -----------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
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

export function getRequestId(req: IncomingMessage): string {
  const decorated = (req as unknown as Record<symbol, unknown>)[APIPILOT_REQUEST_ID];
  if (typeof decorated === "string" && decorated.length > 0) return decorated;
  return "";
}

function metaFor(req: IncomingMessage, extra: Record<string, unknown> = {}): ApiMeta {
  return createMeta(getRequestId(req), extra);
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

/** Sends a success envelope. `data` may be null — key always present. */
export function sendSuccess<T>(
  req: IncomingMessage,
  res: ServerResponse,
  data: T,
  options: { status?: number; message?: string | null; jsonOptions?: JsonOptions } = {},
): void {
  const jsonOpts = options.jsonOptions ?? { namingPolicy: "camelCase", enumMode: "string", dateMode: "iso8601" };
  const transformed = transformData(data, jsonOpts);
  const envelope = success(transformed, metaFor(req), options.message ?? null);
  writeJson(res, options.status ?? 200, envelope);
}

/** Sends a paginated envelope. */
export function sendPaginated<T>(
  req: IncomingMessage,
  res: ServerResponse,
  data: T,
  pagination: ApiPagination,
  options: { status?: number; message?: string | null; jsonOptions?: JsonOptions } = {},
): void {
  const jsonOpts = options.jsonOptions ?? { namingPolicy: "camelCase", enumMode: "string", dateMode: "iso8601" };
  const transformed = transformData(data, jsonOpts);
  const envelope = paginated(transformed, pagination, metaFor(req), options.message ?? null);
  writeJson(res, options.status ?? 200, envelope);
}

/** Sends an error envelope for a standard or custom code. */
export function sendError(
  req: IncomingMessage,
  res: ServerResponse,
  code: ApiErrorCode | string,
  message: string,
  options: { status?: number; fields?: Record<string, string[]>; headers?: Record<string, string> } = {},
): void {
  const resolved = typeof code === "string" ? ApiErrorCode.from(code) : code;
  const status = options.status ?? resolved.httpStatus;
  const envelope = failure(resolved, message, metaFor(req), options.fields);
  writeJson(res, status, envelope, options.headers);
}

/** Sends a VALIDATION_ERROR envelope with field errors. */
export function sendValidationError(
  req: IncomingMessage,
  res: ServerResponse,
  fields: Record<string, string[]>,
  message?: string,
): void {
  const envelope = validationFailure(fields, metaFor(req), message);
  writeJson(res, 400, envelope);
}

/** Sends a RATE_LIMITED envelope with optional Retry-After. */
export function sendRateLimited(
  req: IncomingMessage,
  res: ServerResponse,
  retryAfterSeconds?: number,
): void {
  const headers = retryAfterSeconds !== undefined
    ? { "retry-after": String(Math.ceil(retryAfterSeconds)) }
    : {};
  sendError(req, res, ApiErrorCode.RateLimited, "Too many requests.", { headers });
}

export { buildPagination };
export type { ApiPagination };
