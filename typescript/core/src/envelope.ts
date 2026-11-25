// filepath: src/envelope.ts
// layer: Responses | package: @apipilot/core | since: v0.1.0
// purpose: Response envelope types and builders — success, collection, paginated, error.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : error-codes.ts
//   Used by    : adapters (Fastify/Express/etc.), conformance runner
//   See also   : SPEC.md#response-envelopes, docs/response-contract.md (C# reference)
// -----------------------------------------------------------------------------

import { ApiErrorCode } from "./error-codes.js";

/** Meta object carried by every envelope. Envelope keys are pinned — never renamed by naming policy. */
export interface ApiMeta {
  requestId: string;
  timestamp: string;
  extra: Record<string, unknown>;
}

/** Pagination block on paginated envelopes. All six fields required when present. */
export interface ApiPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/** Error object inside the error envelope. `fields` present only for VALIDATION_ERROR. */
export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
}

/** Success envelope: { success: true, data, message, meta }. */
export interface ApiSuccessEnvelope<T = unknown> {
  success: true;
  data: T;
  message: string | null;
  meta: ApiMeta;
}

/** Paginated envelope: success envelope + pagination sibling of data. */
export interface ApiPaginatedEnvelope<T = unknown> extends ApiSuccessEnvelope<T> {
  pagination: ApiPagination;
}

/** Error envelope: { success: false, error, meta? }. */
export interface ApiErrorEnvelope {
  success: false;
  error: ApiError;
  meta?: ApiMeta | { requestId: string };
}

export type ApiEnvelope<T = unknown> = ApiSuccessEnvelope<T> | ApiPaginatedEnvelope<T> | ApiErrorEnvelope;

/** Creates a meta object with the given request id and current timestamp. */
export function createMeta(requestId: string, extra: Record<string, unknown> = {}): ApiMeta {
  return { requestId, timestamp: new Date().toISOString(), extra };
}

/** Builds a success envelope. `data` may be null — the key is always present. */
export function success<T>(data: T, meta: ApiMeta, message: string | null = null): ApiSuccessEnvelope<T> {
  return { success: true, data, message, meta };
}

/** Builds a paginated envelope. */
export function paginated<T>(
  data: T,
  pagination: ApiPagination,
  meta: ApiMeta,
  message: string | null = null,
): ApiPaginatedEnvelope<T> {
  return { success: true, data, message, meta, pagination };
}

/** Builds an error envelope. `fields` included only when provided. */
export function failure(
  code: ApiErrorCode | string,
  message: string,
  meta?: ApiMeta | { requestId: string },
  fields?: Record<string, string[]>,
): ApiErrorEnvelope {
  const error: ApiError = {
    code: typeof code === "string" ? code : code.value,
    message,
  };
  if (fields !== undefined) {
    error.fields = fields;
  }
  const envelope: ApiErrorEnvelope = { success: false, error };
  if (meta !== undefined) {
    envelope.meta = meta;
  }
  return envelope;
}

/** Builds a VALIDATION_ERROR envelope with field errors.
 *
 * Mirrors ValidationResponseFactory.FromFields: null/undefined or
 * whitespace message falls back to the C# DefaultMessage.
 */
export function validationFailure(
  fields: Record<string, string[]>,
  meta: ApiMeta,
  message?: string,
): ApiErrorEnvelope {
  const effective = message === undefined || message.trim() === ""
    ? "One or more values are invalid."
    : message;
  return failure(ApiErrorCode.ValidationError, effective, meta, fields);
}
