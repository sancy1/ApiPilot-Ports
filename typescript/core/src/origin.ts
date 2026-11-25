// filepath: src/origin.ts
// layer: Security | package: @apipilot/core | since: v0.1.0
// purpose: RFC 6454 origin parsing and matching — mirrors OriginValidator (pure core).
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Used by    : adapters' origin-policy middleware, conformance runner
//   See also   : docs/origin-policy.md (C# reference)
// -----------------------------------------------------------------------------

/** Parsed origin parts. Port is 0 when the scheme has no defined default. */
export interface OriginParts {
  scheme: string;
  host: string;
  port: number;
}

export type OriginMatchMode = "exact" | "anyPortSameHost" | "sameSite";

const DEFAULT_PORTS: Record<string, number> = {
  https: 443,
  http: 80,
  wss: 443,
  ws: 80,
};

function defaultPortForScheme(scheme: string): number {
  return DEFAULT_PORTS[scheme] ?? 0;
}

/**
 * Parses an origin string `scheme://host[:port]` into normalized parts.
 * Scheme and host lowercased; missing port → scheme default (0 if none).
 * Rejects: empty, literal "null", non-absolute URIs, paths, queries, fragments.
 * Never throws — returns null on malformed input.
 */
export function tryParseOrigin(raw: string): OriginParts | null {
  if (raw.length === 0) return null;
  if (raw.toLowerCase() === "null") return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // An origin has no path (beyond "/"), query, or fragment.
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search !== "" || url.hash !== "") return null;

  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  const host = url.hostname.toLowerCase();
  if (scheme.length === 0 || host.length === 0) return null;

  // URL.port is "" when not explicit or when it equals the scheme default.
  let port: number;
  if (url.port !== "") {
    port = Number.parseInt(url.port, 10);
  } else {
    port = defaultPortForScheme(scheme);
  }

  return { scheme, host, port };
}

/**
 * Compares two origin strings under the given mode.
 * Returns false when either is malformed. SameSite always returns false
 * (not implemented — mirrors C# behavior).
 */
export function originMatches(
  requestOrigin: string,
  allowedOrigin: string,
  mode: OriginMatchMode,
): boolean {
  const request = tryParseOrigin(requestOrigin);
  const allowed = tryParseOrigin(allowedOrigin);
  if (request === null || allowed === null) return false;

  if (request.scheme !== allowed.scheme) return false;
  if (request.host !== allowed.host) return false;

  if (mode === "exact") return request.port === allowed.port;
  if (mode === "anyPortSameHost") return true;
  return false; // sameSite — not implemented
}
