// filepath: src/error-codes.ts
// layer: Errors | package: @apipilot/core | since: v0.1.0
// purpose: ApiErrorCode value type — the 14 standard codes, From() normalization, and HTTP status mapping.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : n/a (pure logic)
//   Used by    : envelope.ts, exception mapping in adapters
//   See also   : SPEC.md#error-codes, docs/error-contract.md (C# reference)
// -----------------------------------------------------------------------------

/**
 * The fourteen standard ApiPilot error codes and their HTTP status mapping.
 * Mirrors ApiPilot.Core.Errors.ApiErrorCode (C#).
 *
 * Codes are immutable string values. `ApiErrorCode.from` trims and
 * uppercases input (invariant). Custom codes are permitted but fall
 * through to HTTP 500 unless the application supplies its own mapper.
 */
export class ApiErrorCode {
  private constructor(
    public readonly value: string,
    public readonly httpStatus: number,
  ) {}

  private static readonly registry = new Map<string, ApiErrorCode>();

  private static define(value: string, httpStatus: number): ApiErrorCode {
    const code = new ApiErrorCode(value, httpStatus);
    ApiErrorCode.registry.set(value, code);
    return code;
  }

  /** 400 (422 configurable at the adapter layer). Only code carrying `fields`. */
  static readonly ValidationError = ApiErrorCode.define("VALIDATION_ERROR", 400);
  static readonly AuthenticationRequired = ApiErrorCode.define("AUTHENTICATION_REQUIRED", 401);
  static readonly Forbidden = ApiErrorCode.define("FORBIDDEN", 403);
  static readonly CsrfHeaderMissing = ApiErrorCode.define("CSRF_HEADER_MISSING", 403);
  static readonly CsrfTokenInvalid = ApiErrorCode.define("CSRF_TOKEN_INVALID", 403);
  static readonly CsrfTokenExpired = ApiErrorCode.define("CSRF_TOKEN_EXPIRED", 403);
  static readonly CsrfOriginRejected = ApiErrorCode.define("CSRF_ORIGIN_REJECTED", 403);
  static readonly ResourceNotFound = ApiErrorCode.define("RESOURCE_NOT_FOUND", 404);
  static readonly Conflict = ApiErrorCode.define("CONFLICT", 409);
  static readonly RateLimited = ApiErrorCode.define("RATE_LIMITED", 429);
  static readonly InternalError = ApiErrorCode.define("INTERNAL_ERROR", 500);
  /** Startup-only. Never emitted on the wire. */
  static readonly ConfigurationError = ApiErrorCode.define("CONFIGURATION_ERROR", 500);
  static readonly NotAcceptable = ApiErrorCode.define("NOT_ACCEPTABLE", 406);
  static readonly UnsupportedMediaType = ApiErrorCode.define("UNSUPPORTED_MEDIA_TYPE", 415);

  /** All standard codes, in SPEC.md table order. */
  static readonly all: readonly ApiErrorCode[] = [
    ApiErrorCode.ValidationError,
    ApiErrorCode.AuthenticationRequired,
    ApiErrorCode.Forbidden,
    ApiErrorCode.CsrfHeaderMissing,
    ApiErrorCode.CsrfTokenInvalid,
    ApiErrorCode.CsrfTokenExpired,
    ApiErrorCode.CsrfOriginRejected,
    ApiErrorCode.ResourceNotFound,
    ApiErrorCode.Conflict,
    ApiErrorCode.RateLimited,
    ApiErrorCode.InternalError,
    ApiErrorCode.ConfigurationError,
    ApiErrorCode.NotAcceptable,
    ApiErrorCode.UnsupportedMediaType,
  ];

  /**
   * Normalizes a raw string into an ApiErrorCode. Trims and uppercases
   * (case-insensitive invariant). Returns the canonical instance for
   * standard codes; a new instance for custom codes (HTTP 500).
   *
   * @throws {Error} when raw is null, empty, or whitespace.
   */
  static from(raw: string): ApiErrorCode {
    if (raw === null || raw === undefined) {
      throw new Error("ApiErrorCode.from requires a non-null string.");
    }
    const normalized = raw.trim().toUpperCase();
    if (normalized.length === 0) {
      throw new Error("ApiErrorCode.from requires a non-empty string.");
    }
    return ApiErrorCode.registry.get(normalized) ?? new ApiErrorCode(normalized, 500);
  }

  /** Returns the canonical code for a wire string, or null when invalid. */
  static tryFrom(raw: string | null | undefined): ApiErrorCode | null {
    if (raw === null || raw === undefined) return null;
    try {
      return ApiErrorCode.from(raw);
    } catch {
      return null;
    }
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
