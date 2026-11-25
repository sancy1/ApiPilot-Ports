// filepath: src/csrf-binding.ts
// layer: Security | package: @apipilot/core | since: v0.1.0
// purpose: CSRF binding fingerprint — deterministic SHA-256 base64url, the cross-language interoperability anchor.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Used by    : adapters' CSRF binding provider, conformance runner
//   See also   : docs/csrf.md#the-binding-csrfbindingprovider (C# reference)
// -----------------------------------------------------------------------------

import { createHash } from "node:crypto";

/** Purpose prefix mixed into every binding hash. Must match across all language ports. */
export const CSRF_BINDING_PURPOSE = "ApiPilot.Csrf.Binding.v1";

export type CsrfBindingKind = "subject" | "session" | "preauth";

/**
 * Computes the binding fingerprint for a source string.
 * Mirrors CsrfBindingProvider.Fingerprint:
 *   fingerprint = base64url(SHA256("ApiPilot.Csrf.Binding.v1|" + prefixedSource))
 * where prefixedSource is:
 *   subject → source (raw)
 *   session → "session:" + source
 *   preauth → "preauth:" + source
 *
 * Deterministic across restarts and languages — pinned by known-answer vectors.
 */
export function csrfBindingFingerprint(source: string, kind: CsrfBindingKind): string {
  const prefixed =
    kind === "session" ? `session:${source}` : kind === "preauth" ? `preauth:${source}` : source;

  const hash = createHash("sha256")
    .update(`${CSRF_BINDING_PURPOSE}|${prefixed}`, "utf8")
    .digest();

  return hash.toString("base64url");
}
