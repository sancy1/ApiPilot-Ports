// filepath: src/rate-limit.ts
// layer: Middleware | package: @apipilot/node | since: v0.1.0
// purpose: Fixed-window rate limiting — mirrors ApiPilotRateLimitOptions (C#, Option D).
// -----------------------------------------------------------------------------

import type { RateLimitOptions } from "./options.js";

interface Window {
  count: number;
  resetAt: number; // epoch ms
}

/**
 * Fixed-window rate limiter. One instance per middleware registration;
 * windows are keyed by the configured key extractor (default client IP).
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
