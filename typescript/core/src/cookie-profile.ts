// filepath: src/cookie-profile.ts
// layer: Security | package: @apipilot/core | since: v0.1.0
// purpose: Cookie profile validation rules — mirrors CookieProfileOptionsValidator (pure core).
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Used by    : adapters' startup validation, conformance runner
//   See also   : docs/cookies.md (C# reference)
// -----------------------------------------------------------------------------

export type CookieSameSite = "lax" | "none" | "strict" | "unspecified";

export type CookieProfileRole = "auth" | "session" | "csrf";

export interface CookieProfile {
  /** Base name without prefix. */
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: CookieSameSite;
  path: string;
  domain: string | null;
  /** One of "", "__Host-", "__Secure-". */
  namePrefix: "" | "__Host-" | "__Secure-";
}

export const DEFINED_PREFIXES = ["", "__Host-", "__Secure-"] as const;

/** RFC 6265 cookie-name forbidden characters: control chars, whitespace, DQUOTE, comma, semicolon, backslash. */
function hasForbiddenNameChar(name: string): boolean {
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
    if (ch === " " || ch === '"' || ch === "," || ch === ";" || ch === "\\") return true;
  }
  return false;
}

function isValidDomain(domain: string): boolean {
  // No scheme, path, port, or whitespace; must look like a hostname.
  if (/[\s/:@]/.test(domain)) return false;
  if (domain.length === 0) return false;
  // Labels: alnum, hyphen, dot-separated; no leading/trailing hyphen per label (lenient).
  return /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(domain);
}

/**
 * Validates a cookie profile against the startup rules.
 * Returns canonical violation codes (empty array = valid).
 * Mirrors CookieProfileOptionsValidator + HostPrefixValidator.
 */
export function validateCookieProfile(profile: CookieProfile, _role: CookieProfileRole): string[] {
  const violations: string[] = [];
  const effectiveName = profile.namePrefix + profile.name;

  // Prefix must be one of the defined set.
  if (!DEFINED_PREFIXES.includes(profile.namePrefix as (typeof DEFINED_PREFIXES)[number])) {
    violations.push("undefined-prefix");
  }

  // Effective name non-empty and charset-valid.
  if (effectiveName.length === 0) {
    violations.push("empty-name");
  } else if (hasForbiddenNameChar(effectiveName)) {
    violations.push("forbidden-name-char");
  }

  // __Host- rules: Secure + no Domain + Path=/.
  if (profile.namePrefix === "__Host-") {
    if (!profile.secure) violations.push("host-prefix-requires-secure");
    if (profile.domain !== null) violations.push("host-prefix-requires-no-domain");
    if (profile.path !== "/") violations.push("host-prefix-requires-root-path");
  }

  // __Secure- rule: Secure required.
  if (profile.namePrefix === "__Secure-" && !profile.secure) {
    violations.push("secure-prefix-requires-secure");
  }

  // SameSite=None requires Secure.
  if (profile.sameSite === "none" && !profile.secure) {
    violations.push("samesite-none-requires-secure");
  }

  // SameSite must be a defined value.
  if (profile.sameSite === "unspecified") {
    violations.push("undefined-samesite");
  }

  // Path: non-empty, must start with /.
  if (profile.path.length === 0 || !profile.path.startsWith("/")) {
    violations.push("path-must-start-slash");
  }

  // Domain: valid hostname when present.
  if (profile.domain !== null && !isValidDomain(profile.domain)) {
    violations.push("invalid-domain");
  }

  return violations;
}

/** The three default profiles from docs/cookies.md. */
export const DEFAULT_COOKIE_PROFILES: Record<CookieProfileRole, CookieProfile> = {
  auth: { name: "auth", secure: true, httpOnly: true, sameSite: "lax", path: "/", domain: null, namePrefix: "" },
  session: { name: "session", secure: true, httpOnly: true, sameSite: "strict", path: "/", domain: null, namePrefix: "" },
  csrf: { name: "csrf", secure: true, httpOnly: false, sameSite: "lax", path: "/", domain: null, namePrefix: "" },
};
