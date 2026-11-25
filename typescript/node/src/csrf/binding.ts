// filepath: src/csrf/binding.ts
// layer: Security | package: @apipilot/node | since: v0.1.0
// purpose: CSRF binding resolution — subject → session → preauth, mirroring
//          CsrfBindingProvider (C#) and binding.ts (@apipilot/fastify).
// -----------------------------------------------------------------------------

import type { IncomingMessage } from "node:http";
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
 *   1. subject claim (via subjectExtractor)
 *   2. session id (via sessionExtractor)
 *   3. pre-auth source delegate
 * Never produces anonymous bindings — returns null on failure.
 */
export interface CsrfBindingResolver {
  resolve(request: IncomingMessage): CsrfBindingResult | null;
}

export interface CsrfBindingResolverOptions {
  /** Extracts the subject identifier from the request (e.g. JWT sub claim). */
  subjectExtractor?: (request: IncomingMessage) => string | null;
  /** Extracts the session id from the request. */
  sessionExtractor?: (request: IncomingMessage) => string | null;
  /** Pre-auth binding source for unauthenticated flows (e.g. login CSRF). */
  preAuthSource?: (request: IncomingMessage) => string | null;
}

export class DefaultCsrfBindingResolver implements CsrfBindingResolver {
  constructor(private readonly options: CsrfBindingResolverOptions = {}) {}

  resolve(request: IncomingMessage): CsrfBindingResult | null {
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
