/**
 * Koa adapter for ApiPilot.
 *
 * Koa middleware has signature `(ctx, next)` where `ctx.req`/`ctx.res`
 * are the raw Node `IncomingMessage`/`ServerResponse` — so the entire
 * Connect-style pipeline runs unchanged. Handlers keep access to the
 * raw request via `ctx.req` for `sendSuccess`/`getPagination`/etc.
 *
 * ```ts
 * import Koa from "koa";
 * import { apiPilotKoa, apiPilotKoaErrorHandler } from "@apipilot/node";
 *
 * const app = new Koa();
 * app.use(apiPilotKoa({ csrfKeyRing, paginationEnabled: true }));
 * app.use(routes);
 * app.use(apiPilotKoaErrorHandler()); // last — maps errors to envelopes
 * ```
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { apiPilot, type ApiPilotNodePluginOptions, type ApiPilotMiddleware } from "./middleware.js";
import {
  apiPilotErrorHandler,
  type ApiPilotErrorHandlerOptions,
} from "./exceptions.js";

/** Minimal Koa context shape — avoids a hard @types/koa dependency. */
export interface KoaContextLike {
  req: IncomingMessage;
  res: ServerResponse;
}

/** Koa-style middleware signature. */
export type KoaMiddleware = (
  ctx: KoaContextLike,
  next: () => Promise<unknown>,
) => unknown;

/**
 * Wraps the ApiPilot pipeline as Koa middleware.
 *
 * The pipeline either short-circuits (error envelope / CSRF bootstrap —
 * response already ended) or calls through to Koa's `next()`. Both paths
 * are detected: `next` invocation for pass-through, `res` `finish`/`close`
 * events for short-circuit.
 */
export function apiPilotKoa(input?: ApiPilotNodePluginOptions): KoaMiddleware {
  const mw: ApiPilotMiddleware = apiPilot(input);
  return function apipilotKoa(ctx, next) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: unknown) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      // Short-circuit path: pipeline ended the response itself.
      ctx.res.once("finish", () => finish());
      ctx.res.once("close", () => finish());

      mw(ctx.req, ctx.res, (err?: unknown) => {
        if (err) {
          finish(err);
          return;
        }
        // Pass-through: run the rest of the Koa chain.
        Promise.resolve(next()).then(() => finish(), finish);
      });
    });
  };
}

/**
 * Koa error-handling middleware producing ApiPilot envelopes.
 * Register LAST — catches errors thrown downstream and maps them via
 * the same exception mappers as `apiPilotErrorHandler`.
 */
export function apiPilotKoaErrorHandler(
  input?: ApiPilotErrorHandlerOptions,
): KoaMiddleware {
  const handler = apiPilotErrorHandler(input);
  return async function apipilotKoaErrorHandler(ctx, next) {
    try {
      await next();
    } catch (err) {
      await new Promise<void>((resolve) => {
        handler(err, ctx.req, ctx.res, () => resolve());
      });
    }
  };
}
