// filepath: src/plugin.ts
// layer: Configuration | package: @apipilot/fastify | since: v0.1.0
// purpose: apipilotPlugin — registers all ApiPilot middleware on a Fastify instance.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Depends on : all middleware, csrf/*, options, results
//   Used by    : index.ts, application code
//   See also   : SPEC.md (middleware order), docs/api-inventory.md (C# reference)
// -----------------------------------------------------------------------------

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { resolveOptions, type ApiPilotOptions, type ResolvedApiPilotOptions } from "./options.js";
import { correlationHook } from "./middleware/correlation.js";
import { createExceptionHandler, type ExceptionMapper } from "./middleware/exceptions.js";
import { contentNegotiationHook } from "./middleware/content-negotiation.js";
import { originHook } from "./middleware/origin.js";
import { fetchMetadataHook } from "./middleware/fetch-metadata.js";
import { csrfHook, registerCsrfBootstrap, type CsrfMiddlewareDeps } from "./middleware/csrf.js";
import { RateLimiter, rateLimitHook } from "./middleware/rate-limit.js";
import { CsrfProtector, keyRingFromEnv, type CsrfKeyRing } from "./csrf/protector.js";
import { CsrfService } from "./csrf/service.js";
import { DefaultCsrfBindingResolver, type CsrfBindingResolverOptions } from "./csrf/binding.js";
import { attachRotationStore } from "./csrf/extras.js";

export const APIPILOT_OPTIONS = Symbol("apipilot.options");

export interface ApiPilotPluginOptions extends ApiPilotOptions {
  /** CSRF key ring. When omitted and csrf.enabled, keyRingFromEnv() is used. */
  csrfKeyRing?: CsrfKeyRing;
  /** CSRF binding resolver configuration. */
  csrfBinding?: CsrfBindingResolverOptions;
  /** Custom exception mappers, tried before defaults. */
  exceptionMappers?: ExceptionMapper[];
  /** Logger for unhandled exceptions. */
  logger?: { error: (obj: object, msg?: string) => void };
}

declare module "fastify" {
  interface FastifyInstance {
    apipilot: {
      options: ResolvedApiPilotOptions;
      csrf: CsrfMiddlewareDeps | undefined;
    };
  }
}

/**
 * Registers ApiPilot on a Fastify instance. Middleware order mirrors the
 * C# pipeline: correlation → (error handler wraps all) → content-negotiation
 * → origin → fetch-metadata → csrf.
 *
 * @example
 * ```ts
 * import Fastify from "fastify";
 * import { apipilotPlugin } from "@apipilot/fastify";
 *
 * const app = Fastify();
 * await app.register(apipilotPlugin, {
 *   csrf: { enabled: true },
 *   origin: { enabled: true, allowedOrigins: ["https://app.example.com"] },
 * });
 * ```
 */
export const apipilotPlugin: FastifyPluginAsync<ApiPilotPluginOptions> = async (fastify, opts) => {
  const options = resolveOptions(opts);

  // --- CSRF wiring (only when enabled) ---
  let csrfDeps: CsrfMiddlewareDeps | undefined;
  if (options.csrf.enabled) {
    if (options.csrf.rotationRequirement === "required" && !options.csrf.rotationStore) {
      throw new Error("csrf.rotationRequirement='required' but no rotationStore configured");
    }
    const keyRing = opts.csrfKeyRing ?? keyRingFromEnv();
    const protector = new CsrfProtector(keyRing);
    const bindingResolver = new DefaultCsrfBindingResolver(opts.csrfBinding ?? {});
    const service = new CsrfService(protector, bindingResolver, {
      tokenLifetimeSeconds: options.csrf.tokenLifetimeSeconds,
      tokenEntropyBytes: options.csrf.tokenEntropyBytes,
    });
    if (options.csrf.rotationStore) {
      attachRotationStore(service, options.csrf.rotationStore);
    }
    csrfDeps = { service, bindingResolver, options: options.csrf };
  }

  // --- Decorate instance ---
  fastify.decorate("apipilot", { options, csrf: csrfDeps });

  // --- Error handler (wraps everything downstream) ---
  fastify.setErrorHandler(
    createExceptionHandler({
      options: options.exceptions,
      customMappers: opts.exceptionMappers ?? [],
      logger: opts.logger,
    }),
  );

  // --- onRequest hooks in pipeline order ---
  fastify.addHook("onRequest", correlationHook(options.correlation));
  if (options.rateLimit.enabled) {
    fastify.addHook("onRequest", rateLimitHook(options.rateLimit, new RateLimiter(options.rateLimit)));
  }
  fastify.addHook("onRequest", contentNegotiationHook(options.contentNegotiation));
  fastify.addHook("onRequest", originHook(options.origin));
  fastify.addHook("onRequest", fetchMetadataHook(options.fetchMetadata));

  // --- CSRF (preHandler — after routing metadata is available) ---
  if (csrfDeps) {
    fastify.addHook("preHandler", csrfHook(csrfDeps));
    registerCsrfBootstrap(fastify, csrfDeps);
  }
};

export default fp(apipilotPlugin, { name: "apipilot" });
