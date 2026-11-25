// filepath: src/middleware/rate-limit.ts
// layer: Middleware | package: @apipilot/fastify | since: v0.1.0
// purpose: Fixed-window rate limiting — mirrors ApiPilotRateLimitOptions (C#, Option D).
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : ../results, ../options, @apipilot/core
//   Used by    : plugin.ts
//   See also   : docs/rate-limiting.md (C# reference)
// -----------------------------------------------------------------------------

import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiErrorCode } from "@apipilot/core";
import { sendError } from "../results.js";
import { metricsFor } from "../observability.js";
import type { RateLimitOptions } from "../options.js";

interface Window {
  count: number;
  resetAt: number; // epoch ms
}

/**
 * Fixed-window rate limiter. One instance per plugin registration;
 * windows are keyed by the configured key extractor (default request.ip).
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(options: RateLimitOptions) {
    this.limit = options.requestsPerWindow > 0 ? options.requestsPerWindow : 100;
    this.windowMs = (options.windowSeconds > 0 ? options.windowSeconds : 60) * 1000;
  }

  /** Returns true when the key may proceed; otherwise seconds until reset (>= 1). */
  allow(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const w = this.windows.get(key);
    if (w === undefined || now >= w.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (w.count >= this.limit) {
      const secs = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
      return { allowed: false, retryAfterSeconds: secs };
    }
    w.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Fastify onRequest hook enforcing the fixed-window limit.
 * Rejection → RATE_LIMITED envelope (429) with optional Retry-After.
 */
export function rateLimitHook(options: RateLimitOptions, limiter: RateLimiter) {
  return async function rateLimit(request: FastifyRequest, reply: FastifyReply) {
    const key = options.keyExtractor
      ? options.keyExtractor(request as unknown as { ip: string })
      : (request.ip ?? "anonymous");
    const { allowed, retryAfterSeconds } = limiter.allow(key);
    if (allowed) return undefined;

    metricsFor(request).recordRateLimited();
    if (options.setRetryAfterHeader && retryAfterSeconds > 0) {
      reply.header("Retry-After", String(retryAfterSeconds));
    }
    await sendError(request, reply, ApiErrorCode.RateLimited, options.message);
    return reply;
  };
}
