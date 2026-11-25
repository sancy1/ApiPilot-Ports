// filepath: src/content-negotiation.ts
// layer: RequestHandling | package: @apipilot/core | since: v0.1.0
// purpose: Accept / Content-Type evaluation — pure cores of ApiPilotContentNegotiationMiddleware.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Used by    : adapters' content-negotiation middleware, conformance runner
//   See also   : docs/content-negotiation.md (C# reference)
// -----------------------------------------------------------------------------

export interface ContentNegotiationOptions {
  /** Case-insensitive membership (C# HashSet OrdinalIgnoreCase). */
  acceptableResponseMediaTypes: readonly string[];
  acceptWildcard: boolean;
  /** Case-insensitive membership. */
  acceptableRequestMediaTypes: readonly string[];
  acceptMissingContentType: boolean;
  /** Case-insensitive membership. */
  bodyCarryingMethods: readonly string[];
}

export const DEFAULT_CONTENT_NEGOTIATION_OPTIONS: ContentNegotiationOptions = {
  acceptableResponseMediaTypes: ["application/json"],
  acceptWildcard: true,
  acceptableRequestMediaTypes: ["application/json"],
  acceptMissingContentType: false,
  bodyCarryingMethods: ["POST", "PUT", "PATCH"],
};

export type NegotiationStatus = 200 | 406 | 415;

export interface NegotiationDecision {
  acceptResult: "accept" | "reject";
  contentTypeResult: "accept" | "reject" | "skip";
  status: NegotiationStatus;
}

function containsCaseInsensitive(set: readonly string[], value: string): boolean {
  const lower = value.toLowerCase();
  return set.some((entry) => entry.toLowerCase() === lower);
}

/** Takes the segment before the first ';', trimmed. Mirrors ExtractMediaType. */
export function extractMediaType(headerValue: string): string {
  const semi = headerValue.indexOf(";");
  const segment = semi < 0 ? headerValue : headerValue.slice(0, semi);
  return segment.trim();
}

/**
 * Accept header check. Mirrors IsAcceptHeaderAcceptable:
 *   - missing/empty header → accept (caller skips check)
 *   - comma-split, trim, skip empty entries
 *   - media type = before first ';' (q= and all params ignored)
 *   - full wildcard accepted iff acceptWildcard (exact match)
 *   - otherwise case-insensitive membership in acceptableResponseMediaTypes
 *   - type wildcards like "application/star" are NOT honored
 */
export function isAcceptHeaderAcceptable(
  headerValue: string | null,
  options: ContentNegotiationOptions,
): boolean {
  if (headerValue === null || headerValue === "") return true;

  for (const rawEntry of headerValue.split(",")) {
    const entry = rawEntry.trim();
    if (entry.length === 0) continue;

    const mediaType = extractMediaType(entry);
    if (mediaType.length === 0) continue;

    if (options.acceptWildcard && mediaType === "*/*") return true;
    if (containsCaseInsensitive(options.acceptableResponseMediaTypes, mediaType)) return true;
  }

  return false;
}

/** Content-Type check for a single header value. Case-insensitive membership. */
export function isContentTypeAcceptable(
  headerValue: string,
  options: ContentNegotiationOptions,
): boolean {
  const mediaType = extractMediaType(headerValue);
  return containsCaseInsensitive(options.acceptableRequestMediaTypes, mediaType);
}

/**
 * Full negotiation decision for a request. Mirrors middleware InvokeAsync:
 *   1. Accept check (only when header present) → 406 NOT_ACCEPTABLE
 *   2. Content-Type check only for body-carrying methods → 415 UNSUPPORTED_MEDIA_TYPE
 *   Missing Content-Type on body-carrying method → reject unless acceptMissingContentType.
 */
export function evaluateContentNegotiation(
  accept: string | null,
  contentType: string | null,
  method: string,
  options: ContentNegotiationOptions,
): NegotiationDecision {
  const acceptResult = isAcceptHeaderAcceptable(accept, options) ? "accept" : "reject";
  if (acceptResult === "reject") {
    return { acceptResult, contentTypeResult: "skip", status: 406 };
  }

  const isBodyCarrying = options.bodyCarryingMethods.some(
    (m) => m.toLowerCase() === method.toLowerCase(),
  );
  if (!isBodyCarrying) {
    return { acceptResult, contentTypeResult: "skip", status: 200 };
  }

  if (contentType === null || contentType === "") {
    if (options.acceptMissingContentType) {
      return { acceptResult, contentTypeResult: "accept", status: 200 };
    }
    return { acceptResult, contentTypeResult: "reject", status: 415 };
  }

  if (!isContentTypeAcceptable(contentType, options)) {
    return { acceptResult, contentTypeResult: "reject", status: 415 };
  }

  return { acceptResult, contentTypeResult: "accept", status: 200 };
}
