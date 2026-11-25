// filepath: src/diagnostics.ts
// layer: Diagnostics | package: @apipilot/node | since: v0.1.0
// purpose: Security diagnostics surface — mirrors ApiPilotSecurityDiagnostics (C#)
//          and diagnostics.ts (@apipilot/fastify).
// -----------------------------------------------------------------------------

import type { ResolvedApiPilotNodeOptions } from "./options.js";
import { DefaultCsrfBindingResolver, type CsrfBindingResolver } from "./csrf/binding.js";
import type { CsrfKeyRing } from "./csrf/protector.js";

export interface Diagnostic {
  code: string;
  level: "info" | "warning";
  message: string;
}

function bindingConfigured(binding: CsrfBindingResolver | undefined): boolean {
  if (binding === undefined) return false;
  if (!(binding instanceof DefaultCsrfBindingResolver)) return true;
  const opts = (binding as unknown as { options?: Record<string, unknown> }).options;
  return Boolean(
    opts?.subjectExtractor ?? opts?.sessionExtractor ?? opts?.preAuthSource,
  );
}

/**
 * Returns non-fatal diagnostics for the resolved options. Fatal
 * conditions are enforced at middleware creation, not here.
 */
export function diagnostics(
  options: ResolvedApiPilotNodeOptions,
  binding?: CsrfBindingResolver,
): Diagnostic[] {
  const out: Diagnostic[] = [];

  if (options.csrf.enabled && !bindingConfigured(binding)) {
    out.push({
      code: "csrf-no-binding",
      level: "warning",
      message:
        "CSRF is enabled but no binding resolver extractors are configured; " +
        "all bindings resolve to null and requests fail closed.",
    });
  }

  if (options.origin.enabled && options.origin.allowedOrigins.length === 0) {
    out.push({
      code: "origin-empty-allowlist",
      level: "warning",
      message:
        "Origin policy is enabled with an empty allowlist; all unsafe " +
        "requests with an Origin header are rejected.",
    });
  }

  if (options.rateLimit.enabled && options.rateLimit.requestsPerWindow <= 0) {
    out.push({
      code: "rate-limit-default-limit",
      level: "info",
      message:
        "Rate limiting is enabled with the default limit of 100 requests per window.",
    });
  }

  return out;
}

/**
 * Inspects the CSRF key ring for multi-instance safety. Mirrors
 * InstanceSafetyValidator + SharedKeyConfiguration (C#): a single key or
 * missing keys are legal but risky at scale — every instance must share
 * the same ring or tokens issued by one instance fail on another.
 */
export function keyRingDiagnostics(
  keyRing: CsrfKeyRing | undefined,
  csrfEnabled: boolean,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!csrfEnabled) return out;
  const keys = keyRing?.keys ?? {};
  const keyIds = Object.keys(keys);
  if (keyIds.length === 0) {
    out.push({
      code: "csrf-keys-missing",
      level: "warning",
      message:
        "CSRF is enabled but no key ring is configured; tokens cannot be " +
        "issued or validated.",
    });
    return out;
  }
  if (keyIds.length === 1) {
    out.push({
      code: "csrf-single-key",
      level: "info",
      message:
        "CSRF key ring has a single key; rotation requires downtime. Add a " +
        "second key before rotating in multi-instance deployments.",
    });
  }
  if (keyRing && !(keyRing.activeKeyId in keys)) {
    out.push({
      code: "csrf-active-key-missing",
      level: "warning",
      message:
        "The CSRF active key ID is not present in the key ring; new tokens " +
        "cannot be signed.",
    });
  }
  return out;
}
