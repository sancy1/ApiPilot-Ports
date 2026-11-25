// filepath: src/observability.ts
// layer: Observability | package: @apipilot/node | since: v0.1.0
// purpose: Pipeline counters + log redaction — mirrors ApiPilotCsrfCounters,
//          ApiPilotRedactionPolicy, ApiPilotSafeLogger (C#).
// -----------------------------------------------------------------------------

import type { IncomingMessage } from "node:http";

/** ApiPilot request-pipeline counters (in-memory, per-process). */
export class Metrics {
  csrfIssued = 0;
  csrfValidated = 0;
  csrfRejected = 0;
  csrfExpired = 0;
  rateLimited = 0;
  validationFailed = 0;
  originRejected = 0;
  fetchMetadataRejected = 0;
  cookieRejected = 0;

  recordCsrfIssued(): void { this.csrfIssued++; }
  recordCsrfValidated(): void { this.csrfValidated++; }
  recordCsrfRejected(): void { this.csrfRejected++; }
  recordCsrfExpired(): void { this.csrfExpired++; }
  recordRateLimited(): void { this.rateLimited++; }
  recordValidationFailed(): void { this.validationFailed++; }
  recordOriginRejected(): void { this.originRejected++; }
  recordFetchMetadataRejected(): void { this.fetchMetadataRejected++; }
  recordCookieRejected(): void { this.cookieRejected++; }

  /** Returns a copy of the current counter values. */
  snapshot(): Record<string, number> {
    return {
      "csrf.issued": this.csrfIssued,
      "csrf.validated": this.csrfValidated,
      "csrf.rejected": this.csrfRejected,
      "csrf.expired": this.csrfExpired,
      "rate_limited": this.rateLimited,
      "validation_failed": this.validationFailed,
      "origin_rejected": this.originRejected,
      "fetch_metadata_rejected": this.fetchMetadataRejected,
      "cookie_rejected": this.cookieRejected,
    };
  }
}

/** Shared default metrics instance. */
export const DEFAULT_METRICS = new Metrics();

const METRICS_KEY = Symbol("apipilot.metrics");

/** Attaches a Metrics instance to the request (used by the middleware). */
export function attachMetrics(req: IncomingMessage, metrics: Metrics): void {
  (req as unknown as Record<symbol, unknown>)[METRICS_KEY] = metrics;
}

/** Resolves the Metrics instance for a request. */
export function metricsFor(req: IncomingMessage): Metrics {
  const m = (req as unknown as Record<symbol, unknown>)[METRICS_KEY];
  return m instanceof Metrics ? m : DEFAULT_METRICS;
}

/** Controls which log fields are masked — mirrors ApiPilotRedactionPolicy (C#). */
export interface RedactionPolicy {
  /** Case-insensitive substring match on field names. */
  sensitiveKeys?: string[];
}

export const DEFAULT_REDACTION_POLICY: Required<RedactionPolicy> = {
  sensitiveKeys: [
    "password", "passwd", "secret", "token", "apikey", "api_key",
    "authorization", "cookie", "session", "csrf", "creditcard",
    "ssn", "privatekey", "private_key",
  ],
};

const BEARER_RE = /bearer\s+[a-z0-9\-._~+/]+=*/gi;

/** Masks bearer tokens and sensitive key=value pairs in a string. */
export function redactString(value: string, policy: RedactionPolicy = DEFAULT_REDACTION_POLICY): string {
  let out = value.replace(BEARER_RE, "Bearer [REDACTED]");
  for (const key of policy.sensitiveKeys ?? DEFAULT_REDACTION_POLICY.sensitiveKeys) {
    const re = new RegExp(`(${escapeRegExp(key)})(\\s*[=:]\\s*)([^\\s,;&]+)`, "gi");
    out = out.replace(re, "$1$2[REDACTED]");
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns a copy of the object with sensitive values masked. */
export function redactValue<T>(value: T, policy: RedactionPolicy = DEFAULT_REDACTION_POLICY): T {
  if (value === null || typeof value !== "object") {
    return typeof value === "string" ? (redactString(value, policy) as T) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, policy)) as T;
  }
  const keys = policy.sensitiveKeys ?? DEFAULT_REDACTION_POLICY.sensitiveKeys;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (keys.some((sk) => lower.includes(sk.toLowerCase()))) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactValue(v, policy);
    }
  }
  return out as T;
}
