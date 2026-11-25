// filepath: src/csrf/binding.ts
// layer: Security | package: @apipilot/fastify | since: v0.1.0
// purpose: CSRF binding resolution — subject → session → preauth, mirroring CsrfBindingProvider.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Used by    : csrf/service.ts, middleware/csrf.ts
//   See also   : docs/csrf.md#the-binding-csrfbindingprovider (C# reference)
// -----------------------------------------------------------------------------

import type { FastifyRequest } from "fastify";
import { csrfBindingFingerprint } from "@apipilot/core";

export type CsrfBindingFailureReason =
  | "noSubject"
  | "noSession"
  | "noPreAuthSource"
  | "providerFailure";

export interface CsrfBindingResult {
  fingerprint: string;
  /** The raw source string (never logged). */
  source: string;
  kind: "subject" | "session" | "preauth";
}

/**
 * Resolves the CSRF binding for a request. Resolution order mirrors
 * CsrfBindingProvider.TryGetBinding:
 *   1. subject claim (request.user / request.auth subject)
 *   2. session id (request.session.id or configured session cookie)
 *   3. pre-auth source delegate
 * Never produces anonymous bindings — returns null on failure.
 */
export interface CsrfBindingResolver {
  resolve(request: FastifyRequest): CsrfBindingResult | null;
}

export interface CsrfBindingResolverOptions {
  /** Extracts the subject identifier from the request (e.g. JWT sub claim). */
  subjectExtractor?: (request: FastifyRequest) => string | null;
  /** Extracts the session id from the request. */
  sessionExtractor?: (request: FastifyRequest) => string | null;
  /** Pre-auth binding source for unauthenticated flows (e.g. login CSRF). */
  preAuthSource?: (request: FastifyRequest) => string | null;
}

export class DefaultCsrfBindingResolver implements CsrfBindingResolver {
  constructor(private readonly options: CsrfBindingResolverOptions = {}) {}

  resolve(request: FastifyRequest): CsrfBindingResult | null {
    const subject = this.options.subjectExtractor?.(request) ?? null;
    if (subject !== null && subject !== "") {
      return {
        fingerprint: csrfBindingFingerprint(subject, "subject"),
        source: subject,
        kind: "subject",
      };
    }

    const sessionId = this.options.sessionExtractor?.(request) ?? null;
    if (sessionId !== null && sessionId !== "") {
      return {
        fingerprint: csrfBindingFingerprint(sessionId, "session"),
        source: sessionId,
        kind: "session",
      };
    }

    const preAuth = this.options.preAuthSource?.(request) ?? null;
    if (preAuth !== null && preAuth !== "") {
      return {
        fingerprint: csrfBindingFingerprint(preAuth, "preauth"),
        source: preAuth,
        kind: "preauth",
      };
    }

    return null;
  }
}
