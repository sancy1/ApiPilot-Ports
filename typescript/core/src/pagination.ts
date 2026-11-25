// filepath: src/pagination.ts
// layer: Pagination | package: @apipilot/core | since: v0.1.0
// purpose: Pagination options, query parsing/validation, and result math — mirrors ApiPilot.Core.Pagination.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : envelope.ts (ApiPagination)
//   Used by    : adapters, conformance runner
//   See also   : SPEC.md#pagination, docs/pagination.md (C# reference)
// -----------------------------------------------------------------------------

import type { ApiPagination } from "./envelope.js";

/** Query parameter names. Mirrors QueryParameterNames defaults. */
export interface PaginationParameterNames {
  page: string;
  pageSize: string;
  sort: string;
  direction: string;
}

export const DEFAULT_PARAMETER_NAMES: PaginationParameterNames = {
  page: "page",
  pageSize: "pageSize",
  sort: "sort",
  direction: "direction",
};

/** Pagination options — the ten transformations T1–T10 from docs/pagination.md. */
export interface PaginationOptions {
  /** T1: default page size when query omits pageSize. Default 20. */
  defaultPageSize: number;
  /** T2: maximum allowed page size. Default 100. */
  maxPageSize: number;
  /** T3: wire page-number base. Default 1. Internal PageRequest is always 1-based. */
  pageNumberBase: number;
  /** T4: HTTP status for successful paginated responses. Default 200. */
  successStatusCode: number;
  /** T5: strict query validation — reject unrecognized params. Default false. */
  strictQueryValidation: boolean;
  /** T6: parameter names. */
  parameterNames: PaginationParameterNames;
  /** T7: integer parser for page/pageSize. */
  integerParser: (raw: string) => number | null;
  /** T8: sort parser — field+direction → SortRequest or null. */
  sortParser: ((field: string, direction: SortDirection) => SortRequest | null) | null;
  /** T9: direction parser — raw token → SortDirection or null. */
  sortDirectionParser: ((raw: string) => SortDirection | null) | null;
  /** T10: filter predicate — is this query param a filter? null = lenient (all non-control). */
  isFilterParameter: ((name: string) => boolean) | null;
}

export type SortDirection = "asc" | "desc";

export interface SortRequest {
  field: string;
  direction: SortDirection;
}

export interface FilterRequest {
  parameters: Record<string, string>;
}

/** Validated 1-based page request. Mirrors PageRequest. */
export interface PageRequest {
  page: number;
  pageSize: number;
}

export const DEFAULT_PAGINATION_OPTIONS: PaginationOptions = {
  defaultPageSize: 20,
  maxPageSize: 100,
  pageNumberBase: 1,
  successStatusCode: 200,
  strictQueryValidation: false,
  parameterNames: { ...DEFAULT_PARAMETER_NAMES },
  integerParser: defaultIntegerParser,
  sortParser: null,
  sortDirectionParser: null,
  isFilterParameter: null,
};

/** Default integer parser: int.TryParse equivalent — optional sign, digits only. */
export function defaultIntegerParser(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

/** Creates a PageRequest with validation. Throws RangeError on violation. */
export function createPageRequest(page: number, pageSize: number, options: PaginationOptions): PageRequest {
  if (page < 1) throw new RangeError("Page must be at least 1.");
  if (pageSize < 1) throw new RangeError("PageSize must be at least 1.");
  if (pageSize > options.maxPageSize) {
    throw new RangeError(`PageSize must not exceed the configured maximum of ${options.maxPageSize}.`);
  }
  return { page, pageSize };
}

/** FromQuery: fills nulls with defaults (page 1, defaultPageSize) then validates. */
export function pageRequestFromQuery(
  page: number | null | undefined,
  pageSize: number | null | undefined,
  options: PaginationOptions,
): PageRequest {
  return createPageRequest(page ?? 1, pageSize ?? options.defaultPageSize, options);
}

/** Parses sort direction wire value. Default accepts asc/desc case-insensitive, trimmed. */
export function parseSortDirection(raw: string | null | undefined): SortDirection | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "asc") return "asc";
  if (trimmed === "desc") return "desc";
  return null;
}

export interface PaginationComputation {
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/** Computes the pagination block math. totalPages = ceil(totalItems/pageSize), minimum 1. */
export function computePagination(totalItems: number, page: number, pageSize: number): PaginationComputation {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return {
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}

/** Builds the full ApiPagination block. */
export function buildPagination(totalItems: number, page: number, pageSize: number): ApiPagination {
  const { totalPages, hasNext, hasPrevious } = computePagination(totalItems, page, pageSize);
  return { page, pageSize, totalItems, totalPages, hasNext, hasPrevious };
}

/** Converts a wire page number to the internal 1-based page: wirePage - base + 1. */
export function wirePageToInternal(wirePage: number, pageNumberBase: number): number {
  return wirePage - pageNumberBase + 1;
}

export interface ParsedPaginationQuery {
  pageRequest: PageRequest;
  sort: SortRequest | null;
  filter: FilterRequest | null;
  /** Field-name → messages for VALIDATION_ERROR. Empty when valid. */
  errors: Record<string, string[]>;
}

/**
 * Parses and validates pagination query parameters against effective options.
 * Mirrors PaginationEndpointFilter logic (pure core — the adapter supplies the query map).
 */
export function parsePaginationQuery(
  query: Record<string, string | string[] | undefined>,
  options: PaginationOptions,
): ParsedPaginationQuery {
  const errors: Record<string, string[]> = {};
  const names = options.parameterNames;

  const addError = (field: string, message: string) => {
    (errors[field] ??= []).push(message);
  };

  const first = (key: string): string | undefined => {
    const v = query[key];
    if (v === undefined) return undefined;
    return Array.isArray(v) ? v[0] : v;
  };

  // --- page ---
  let wirePage: number | null = null;
  const rawPage = first(names.page);
  if (rawPage !== undefined && rawPage !== "") {
    wirePage = options.integerParser(rawPage);
    if (wirePage === null) {
      addError(names.page, "The page value is not valid.");
    } else if (wirePage < options.pageNumberBase) {
      addError(names.page, `The page value must be at least ${options.pageNumberBase}.`);
    }
  }

  // --- pageSize ---
  let pageSize: number | null = null;
  const rawPageSize = first(names.pageSize);
  if (rawPageSize !== undefined && rawPageSize !== "") {
    pageSize = options.integerParser(rawPageSize);
    if (pageSize === null) {
      addError(names.pageSize, "The pageSize value is not valid.");
    } else if (pageSize < 1) {
      addError(names.pageSize, "The pageSize value must be at least 1.");
    } else if (pageSize > options.maxPageSize) {
      addError(names.pageSize, `The pageSize value must not exceed ${options.maxPageSize}.`);
    }
  }

  // --- sort ---
  let sort: SortRequest | null = null;
  const rawSort = first(names.sort);
  const rawDirection = first(names.direction);
  const sortPresent = (rawSort !== undefined && rawSort !== "") || (rawDirection !== undefined && rawDirection !== "");
  if (sortPresent) {
    const field = rawSort ?? "";
    let direction: SortDirection | null = null;
    if (rawDirection !== undefined && rawDirection !== "") {
      direction = options.sortDirectionParser
        ? options.sortDirectionParser(rawDirection)
        : parseSortDirection(rawDirection);
      if (direction === null) {
        addError(names.direction, "The direction value is not valid.");
      }
    } else {
      direction = "asc";
    }
    if (field === "") {
      addError(names.sort, "The sort field is required when direction is specified.");
    } else if (direction !== null) {
      if (options.sortParser) {
        sort = options.sortParser(field, direction);
        if (sort === null) {
          addError(names.sort, "The sort expression is not valid.");
        }
      } else {
        sort = { field, direction };
      }
    }
  }

  // --- filters / strict validation ---
  let filter: FilterRequest | null = null;
  const controlNames = new Set([names.page, names.pageSize, names.sort, names.direction]);
  const filterParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (controlNames.has(key)) continue;
    if (value === undefined) continue;
    const strValue = Array.isArray(value) ? value[0] : value;
    if (strValue === undefined) continue;

    const isFilter = options.isFilterParameter ? options.isFilterParameter(key) : !options.strictQueryValidation;
    if (options.strictQueryValidation && !isFilter) {
      addError(key, "This query parameter is not recognized.");
      continue;
    }
    if (isFilter) {
      filterParams[key] = strValue;
    }
  }
  if (Object.keys(filterParams).length > 0) {
    filter = { parameters: filterParams };
  }

  // --- build PageRequest (internal 1-based) ---
  let pageRequest: PageRequest = { page: 1, pageSize: options.defaultPageSize };
  if (Object.keys(errors).length === 0) {
    const effectiveWirePage = wirePage ?? options.pageNumberBase;
    const internalPage = wirePageToInternal(effectiveWirePage, options.pageNumberBase);
    const effectivePageSize = pageSize ?? options.defaultPageSize;
    try {
      pageRequest = createPageRequest(internalPage, effectivePageSize, options);
    } catch {
      // Bounds already validated above; this is a safety net.
    }
  }

  return { pageRequest, sort, filter, errors };
}
