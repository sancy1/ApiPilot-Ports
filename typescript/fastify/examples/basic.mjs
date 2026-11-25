// Runnable ApiPilot Fastify sample.
//
// Demonstrates the full plugin pipeline: correlation IDs, content
// negotiation, origin policy, CSRF (bootstrap + validation), rate
// limiting, and the standard error envelope.
//
// Run (after `npm run build`):
//
//   node examples/basic.mjs
//
// Then:
//
//   curl http://localhost:3000/health
//   curl http://localhost:3000/api/csrf                          # bootstrap → { token }
//   curl -X POST http://localhost:3000/api/items \
//        -H "X-Test-Subject: demo" -H "X-CSRF-Token: <token>" \
//        -H "Origin: http://localhost:3000" -H "Content-Type: application/json" \
//        -d '{"name":"widget"}'

import Fastify from "fastify";
import {
  apipilotPlugin,
  generateKeyMaterial,
  sendSuccess,
} from "../dist/index.js";

const keyRing = {
  activeKeyId: "k1",
  keys: { k1: Buffer.from(generateKeyMaterial(), "base64") },
};

const app = Fastify();

await app.register(apipilotPlugin, {
  csrfKeyRing: keyRing,
  csrfBinding: {
    // Demo binding: subject from a header. Real apps should resolve
    // subject/session bindings from auth state.
    subjectExtractor: (req) => req.headers["x-test-subject"] ?? null,
  },
  csrf: { enabled: true },
  origin: {
    enabled: true,
    allowedOrigins: ["http://localhost:3000"],
    requireOriginHeader: true,
  },
  rateLimit: {
    enabled: true,
    requestsPerWindow: 60,
    windowSeconds: 60,
  },
});

app.get("/health", async (req, reply) => {
  return sendSuccess(req, reply, { status: "ok" });
});

app.post("/api/items", async (req, reply) => {
  return sendSuccess(req, reply, { created: req.body }, { status: 201 });
});

const port = 3000;
await app.listen({ port, host: "127.0.0.1" });
app.log.info(`apipilot sample listening on http://localhost:${port}`);
