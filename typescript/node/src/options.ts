// filepath: src/options.ts
// layer: Configuration | package: @apipilot/node | since: v0.1.0
// purpose: ApiPilotNodeOptions — the single options object for the generic
//          Node adapter. Mirrors ApiPilotOptions (@apipilot/fastify) and
//          ApiPilotOptions (C#).
// -----------------------------------------------------------------------------

import type {
  CorrelationOptions,
  ContentNegotiationOptions,
  FetchMetadataOptions,
  PaginationOptions,
} from "@apipilot/core";
import {
  DEFAULT_CORRELATION_OPTIONS,
  DEFAULT_CONTENT_NEGOTIATION_OPTIONS,
  DEFAULT_COOKIE_PROFILES,
  DEFAULT_FETCH_METADATA_OPTIONS,
  DEFAULT_PAGINATION_OPTIONS,
  validateCookieProfile,
} from "@apipilot/core";
import { DEFAULT_METRICS, Metrics } from "./observability.js";
import type { RotationStore } from "./csrf/extras.js";

export type { CorrelationOptions, ContentNegotiationOptions, FetchMetadataOptions, PaginationOptions };
export {
  DEFAULT_CORRELATION_OPTIONS,
  DEFAULT_CONTENT_NEGOTIATION_OPTIONS,
  DEFAULT_FETCH_METADATA_OPTIONS,
  DEFAULT_PAGINATION_OPTIONS,
};

/** Origin policy options — mirrors OriginPolicyOptions (C#). */
export interface OriginPolicyOptions {
  enabled: boolean;
  /** Origins permitted on unsafe methods. Empty + enabled = reject all. */
  allowedOrigins: string[];
  matchMode: "exact" | "anyPortSameHost" | "sameSite";
  /** When true, fall back to Referer when Origin is absent. */
  allowRefererFallback: boolean;
  /** When true, reject unsafe requests with no Origin and no Referer. */
  requireOriginHeader: boolean;
}

export const DEFAULT_ORIGIN_POLICY_OPTIONS: OriginPolicyOptions = {
  enabled: false,
  allowedOrigins: [],
  matchMode: "exact",
  allowRefererFallback: true,
  requireOriginHeader: false,
};

/** CSRF options — mirrors CsrfOptions (C#). */
export interface CsrfOptions {
  enabled: boolean;
  /** HTTP methods requiring a valid token. Default POST/PUT/PATCH/DELETE. */
  protectedMethods: string[];
  /** Header carrying the token. Default X-CSRF-TOKEN. */
  headerName: string;
  /** Cookie name carrying the auth/session credential. */
  authCookieName: string;
  /** Bootstrap endpoint path. Default /api/csrf. */
  bootstrapPath: string;
  /** Token lifetime in seconds. Default 7200 (2h). */
  tokenLifetimeSeconds: number;
  /** Entropy bytes for the random segment. Default 32. */
  tokenEntropyBytes: number;
  /** "onBootstrap" (default) | "onWindow" | "never" — when bootstrap
   * records a rotation marker. Mirrors CsrfRotationPolicy (C#). */
  rotationPolicy: "onBootstrap" | "onWindow" | "never";
  /** "optional" (default) | "required" — "required" throws at startup
   * when no rotationStore is configured. Mirrors
   * CsrfRotationRequirement (C#). */
  rotationRequirement: "optional" | "required";
  /** Optional RotationStore (csrf/extras). */
  rotationStore?: RotationStore;
}

export const DEFAULT_CSRF_OPTIONS: CsrfOptions = {
  enabled: false,
  protectedMethods: ["POST", "PUT", "PATCH", "DELETE"],
  headerName: "X-CSRF-TOKEN",
  authCookieName: "auth",
  bootstrapPath: "/api/csrf",
  tokenLifetimeSeconds: 7200,
  tokenEntropyBytes: 32,
  rotationPolicy: "onBootstrap",
  rotationRequirement: "optional",
};

/** Cookie profile — mirrors CookieProfile (C#). */
export interface CookieProfileOptions {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "lax" | "none" | "strict" | "unspecified";
  path: string;
  domain: string | null;
  namePrefix: "" | "__Host-" | "__Secure-";
}

export interface CookieProfilesOptions {
  auth: CookieProfileOptions;
  session: CookieProfileOptions;
  csrf: CookieProfileOptions;
}

/** Exception mapping options — mirrors ApiExceptionOptions (C#). */
export interface ExceptionOptions {
  /** When true, exception.Message is echoed for mapped exceptions. Default false. */
  revealExceptionMessage: boolean;
  /** When true, exception type name is appended for INTERNAL_ERROR. Default false. */
  revealExceptionType: boolean;
}

export const DEFAULT_EXCEPTION_OPTIONS: ExceptionOptions = {
  revealExceptionMessage: false,
  revealExceptionType: false,
};

/** Rate-limit options — mirrors ApiPilotRateLimitOptions (C#, Option D). */
export interface RateLimitOptions {
  enabled: boolean;
  /** Max requests per window per key. Default 100. */
  requestsPerWindow: number;
  /** Window length in seconds. Default 60. */
  windowSeconds: number;
  /** Rejection message. Default "Too many requests. Retry later." */
  message: string;
  /** When true, Retry-After is emitted from the window reset. Default true. */
  setRetryAfterHeader: boolean;
  /** Key extractor. Default: client IP from req.socket.remoteAddress. */
  keyExtractor?: (req: { ip: string }) => string;
}

export const DEFAULT_RATE_LIMIT_OPTIONS: RateLimitOptions = {
  enabled: false,
  requestsPerWindow: 100,
  windowSeconds: 60,
  message: "Too many requests. Retry later.",
  setRetryAfterHeader: true,
};

/** JSON serialization policy — mirrors ApiPilotJsonOptions (C#). */
export interface JsonOptions {
  /** Property naming: "camelCase" | "snake_case" | "passthrough". Default camelCase. */
  namingPolicy: "camelCase" | "snake_case" | "passthrough";
  /** Enum serialization: "string" | "number". Default string. */
  enumMode: "string" | "number";
  /** Date serialization: "iso8601" | "unixSeconds" | "unixMs". Default iso8601. */
  dateMode: "iso8601" | "unixSeconds" | "unixMs";
  /** Dictionary key policy; defaults to namingPolicy. */
  dictionaryKeyPolicy?: "camelCase" | "snake_case" | "passthrough";
  /** Omit null values from objects and arrays. */
  ignoreNulls?: boolean;
}

export const DEFAULT_JSON_OPTIONS: JsonOptions = {
  namingPolicy: "camelCase",
  enumMode: "string",
  dateMode: "iso8601",
};

/** Top-level ApiPilot options for the Node adapter. */
export interface ApiPilotNodeOptions {
  correlation?: Partial<CorrelationOptions>;
  contentNegotiation?: Partial<ContentNegotiationOptions>;
  origin?: Partial<OriginPolicyOptions>;
  fetchMetadata?: Partial<FetchMetadataOptions>;
  csrf?: Partial<CsrfOptions>;
  cookies?: Partial<CookieProfilesOptions>;
  exceptions?: Partial<ExceptionOptions>;
  rateLimit?: Partial<RateLimitOptions>;
  json?: Partial<JsonOptions>;
  pagination?: Partial<PaginationOptions>;
  /** When true, the middleware parses/validates pagination query params
   *  and stores the context on the request (getPagination). Default false. */
  paginationEnabled?: boolean;
  /** Pipeline counters. Default: shared DEFAULT_METRICS instance. */
  metrics?: Metrics;
}

/** Resolved options with all defaults applied. */
export interface ResolvedApiPilotNodeOptions {
  correlation: CorrelationOptions;
  contentNegotiation: ContentNegotiationOptions;
  origin: OriginPolicyOptions;
  fetchMetadata: FetchMetadataOptions;
  csrf: CsrfOptions;
  cookies: CookieProfilesOptions;
  exceptions: ExceptionOptions;
  rateLimit: RateLimitOptions;
  json: JsonOptions;
  pagination: PaginationOptions;
  metrics: Metrics;
}

export function resolveOptions(input?: ApiPilotNodeOptions): ResolvedApiPilotNodeOptions {
  const cookies: CookieProfilesOptions = {
    auth: { ...DEFAULT_COOKIE_PROFILES.auth, ...input?.cookies?.auth },
    session: { ...DEFAULT_COOKIE_PROFILES.session, ...input?.cookies?.session },
    csrf: { ...DEFAULT_COOKIE_PROFILES.csrf, ...input?.cookies?.csrf },
  };
  // Startup validation — mirrors CookieProfileOptionsValidator (C#):
  // an invalid profile fails fast instead of shipping a weak cookie.
  const violations: string[] = [];
  for (const role of ["auth", "session", "csrf"] as const) {
    for (const v of validateCookieProfile(cookies[role], role)) {
      violations.push(`${role}: ${v}`);
    }
  }
  if (violations.length > 0) {
    throw new Error(`Invalid cookie profile configuration: ${violations.join(", ")}`);
  }
  return {
    correlation: { ...DEFAULT_CORRELATION_OPTIONS, ...input?.correlation },
    contentNegotiation: { ...DEFAULT_CONTENT_NEGOTIATION_OPTIONS, ...input?.contentNegotiation },
    origin: { ...DEFAULT_ORIGIN_POLICY_OPTIONS, ...input?.origin },
    fetchMetadata: { ...DEFAULT_FETCH_METADATA_OPTIONS, ...input?.fetchMetadata },
    csrf: { ...DEFAULT_CSRF_OPTIONS, ...input?.csrf },
    cookies,
    exceptions: { ...DEFAULT_EXCEPTION_OPTIONS, ...input?.exceptions },
    rateLimit: { ...DEFAULT_RATE_LIMIT_OPTIONS, ...input?.rateLimit },
    json: { ...DEFAULT_JSON_OPTIONS, ...input?.json },
    pagination: { ...DEFAULT_PAGINATION_OPTIONS, ...input?.pagination },
    metrics: input?.metrics ?? DEFAULT_METRICS,
  };
}
