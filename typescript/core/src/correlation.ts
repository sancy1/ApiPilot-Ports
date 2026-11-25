// filepath: src/correlation.ts
// layer: RequestHandling | package: @apipilot/core | since: v0.1.0
// purpose: Correlation ID policy decisions — mirrors CorrelationMiddleware logic (pure core).
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Used by    : adapters' correlation middleware, conformance runner
//   See also   : docs/correlation.md (C# reference)
// -----------------------------------------------------------------------------

import { randomFillSync } from "node:crypto";

export type CorrelationInvalidIdPolicy = "replace" | "reject" | "useAsIs";

export interface CorrelationOptions {
  headerName: string;
  validationPattern: RegExp;
  invalidIdPolicy: CorrelationInvalidIdPolicy;
  echoInResponseHeader: boolean;
  echoInResponseBody: boolean;
}

export const DEFAULT_CORRELATION_OPTIONS: CorrelationOptions = {
  headerName: "X-Request-Id",
  // GUIDv7-shaped: 8-4-4-4-12 hex with version/variant nibbles, plus generic safe tokens.
  validationPattern: /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/,
  invalidIdPolicy: "replace",
  echoInResponseHeader: true,
  echoInResponseBody: true,
};

export type CorrelationDecision =
  | { kind: "use-incoming"; id: string; warn: false }
  | { kind: "generate"; warn: false }
  | { kind: "reject" }
  | { kind: "use-incoming"; id: string; warn: true };

/**
 * Decides the effective correlation ID for a request.
 * Mirrors CorrelationMiddleware:
 *   - absent header → generate
 *   - present + pattern match → use incoming
 *   - present + no match → policy: replace→generate, reject→reject, useAsIs→use+warn
 */
export function resolveCorrelationId(
  headerValue: string | null,
  options: CorrelationOptions,
  patternMatches: boolean,
): CorrelationDecision {
  if (headerValue === null || headerValue === "") {
    return { kind: "generate", warn: false };
  }
  if (patternMatches) {
    return { kind: "use-incoming", id: headerValue, warn: false };
  }
  switch (options.invalidIdPolicy) {
    case "reject":
      return { kind: "reject" };
    case "useAsIs":
      return { kind: "use-incoming", id: headerValue, warn: true };
    case "replace":
    default:
      return { kind: "generate", warn: false };
  }
}

/** Generates a GUIDv7 correlation ID (time-ordered, RFC 9562). */
export function generateGuidV7(): string {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);
  const now = Date.now();

  // 48-bit big-endian unix_ts_ms into bytes 0-5
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // version 7 in high nibble of byte 6
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // variant 10xx in high bits of byte 8
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
