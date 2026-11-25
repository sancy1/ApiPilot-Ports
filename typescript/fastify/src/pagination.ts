// filepath: src/pagination.ts
// layer: Pagination | package: @apipilot/fastify | since: v0.1.0
// purpose: Pagination route integration — parses query, stores PageRequest/Sort/Filter on request.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : @apipilot/core (pagination), ./results
//   Used by    : route handlers via getPagination(request)
//   See also   : docs/pagination.md (C# reference)
// -----------------------------------------------------------------------------

import type { FastifyReply, FastifyRequest } from "fastify";
import {
  parsePaginationQuery,
  DEFAULT_PAGINATION_OPTIONS,
  type PaginationOptions,
  type ParsedPaginationQuery,
} from "@apipilot/core";
import { sendValidationError } from "./results.js";
import { metricsFor } from "./observability.js";

const PAGINATION_KEY = Symbol("apipilot.pagination");

export interface PaginationContext {
  pageRequest: { page: number; pageSize: number };
  sort: { field: string; direction: "asc" | "desc" } | null;
  filter: { parameters: Record<string, string> } | null;
}

/** Retrieves the parsed pagination context stored by the pagination hook. */
export function getPagination(request: FastifyRequest): PaginationContext | null {
  const ctx = (request as unknown as Record<symbol, unknown>)[PAGINATION_KEY];
  return (ctx as PaginationContext | undefined) ?? null;
}

/**
 * Fastify preHandler that parses pagination query parameters.
 * On validation failure → VALIDATION_ERROR envelope (400).
 * On success → stores PaginationContext on the request.
 */
export function paginationHook(overrides?: Partial<PaginationOptions>) {
  const options: PaginationOptions = { ...DEFAULT_PAGINATION_OPTIONS, ...overrides };
  return async function pagination(request: FastifyRequest, reply: FastifyReply) {
    const query = request.query as Record<string, string | string[] | undefined>;
    const parsed: ParsedPaginationQuery = parsePaginationQuery(query, options);

    if (Object.keys(parsed.errors).length > 0) {
      metricsFor(request).recordValidationFailed();
      await sendValidationError(request, reply, parsed.errors);
      return reply;
    }

    const ctx: PaginationContext = {
      pageRequest: parsed.pageRequest,
      sort: parsed.sort,
      filter: parsed.filter,
    };
    (request as unknown as Record<symbol, unknown>)[PAGINATION_KEY] = ctx;
    return undefined;
  };
}
