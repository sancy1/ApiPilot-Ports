// filepath: src/csrf/service.ts
// layer: Security | package: @apipilot/node | since: v0.1.0
// purpose: CSRF token service — issue, validate, rotate. Mirrors CsrfService (C#).
// -----------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import {
  encodeCsrfPayload,
  tryDecodeCsrfPayload,
  csrfBindingFingerprint,
} from "@apipilot/core";
import type { CsrfProtector } from "./protector.js";
import type { CsrfBindingResolver } from "./binding.js";
import { checkRotation } from "./extras.js";

export type CsrfValidationOutcome =
  | "valid"
  | "missingToken"
  | "invalidSignature"
  | "malformedPayload"
  | "expired"
  | "bindingMismatch"
  | "missingBinding"
  | "rotated";

export interface CsrfValidationResult {
  outcome: CsrfValidationOutcome;
  /** Present only when outcome is "valid". */
  bindingFingerprint?: string;
}

export interface CsrfServiceOptions {
  tokenLifetimeSeconds: number;
  tokenEntropyBytes: number;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
}

/**
 * Issues and validates CSRF tokens. Stateless — validity derives from
 * the protected payload (signature + expiry + binding), not server state.
 * Mirrors CsrfService.
 */
export class CsrfService {
  private readonly now: () => number;

  constructor(
    private readonly protector: CsrfProtector,
    private readonly bindingResolver: CsrfBindingResolver,
    private readonly options: CsrfServiceOptions,
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  /** Issues a new token bound to the current request context. */
  issueToken(bindingSource: string, bindingKind: "subject" | "session" | "preauth"): string {
    const fingerprint = csrfBindingFingerprint(bindingSource, bindingKind);
    const issuedAtSeconds = Math.floor(this.now() / 1000);
    const random = randomBytes(this.options.tokenEntropyBytes).toString("base64url");
    const payload = encodeCsrfPayload(issuedAtSeconds, random, fingerprint);
    return this.protector.protect(payload);
  }

  /**
   * Validates a wire token against the expected binding.
   * Mirrors CsrfService.ValidateWithMetadata outcome ordering:
   * signature → decode → binding → expiry.
   */
  validateToken(token: string | null | undefined, expectedFingerprint: string): CsrfValidationResult {
    if (token === null || token === undefined || token === "") {
      return { outcome: "missingToken" };
    }

    const plaintext = this.protector.unprotect(token);
    if (plaintext === null) {
      return { outcome: "invalidSignature" };
    }

    const parts = tryDecodeCsrfPayload(plaintext);
    if (parts === null) {
      return { outcome: "malformedPayload" };
    }

    if (parts.bindingFingerprint !== expectedFingerprint) {
      return { outcome: "bindingMismatch" };
    }

    const rotated = checkRotation(this, parts.bindingFingerprint, parts.issuedAtUnixSeconds);
    if (rotated !== null) {
      return { outcome: rotated, bindingFingerprint: parts.bindingFingerprint };
    }

    const nowSeconds = Math.floor(this.now() / 1000);
    const ageSeconds = nowSeconds - parts.issuedAtUnixSeconds;
    if (ageSeconds > this.options.tokenLifetimeSeconds) {
      return { outcome: "expired" };
    }

    return { outcome: "valid", bindingFingerprint: parts.bindingFingerprint };
  }
}
