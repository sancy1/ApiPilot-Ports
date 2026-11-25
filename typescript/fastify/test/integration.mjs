// filepath: test/integration.mjs
// layer: test | package: @apipilot/fastify | since: v0.1.0
// purpose: Integration tests — Fastify inject() against the ApiPilot plugin.
// -----------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { apipilotPlugin, generateKeyMaterial, sendSuccess, sendError } from "../dist/index.js";
import { ApiErrorCode } from "@apipilot/core";

const KEY = generateKeyMaterial();
const keyRing = { activeKeyId: "k1", keys: { k1: Buffer.from(KEY, "base64") } };

async function buildApp(pluginOpts = {}, routes = null) {
  const app = Fastify();
  await app.register(apipilotPlugin, {
    csrfKeyRing: keyRing,
    csrfBinding: {
      subjectExtractor: (req) => req.headers["x-test-subject"] ?? null,
    },
    ...pluginOpts,
  });
  if (routes) await routes(app);
  else {
    app.get("/ping", async (req, reply) => sendSuccess(req, reply, { pong: true }));
    app.post("/echo", async (req, reply) => sendSuccess(req, reply, { ok: true }));
    app.get("/fail", async (req, reply) => sendError(req, reply, ApiErrorCode.ResourceNotFound, "Missing."));
  }
  await app.ready();
  return app;
}

test("success envelope shape", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/ping" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.data, { pong: true });
  assert.equal(body.message, null);
  assert.ok(body.meta.requestId);
  assert.ok(body.meta.timestamp);
  assert.equal(res.headers["x-request-id"], body.meta.requestId);
  await app.close();
});

test("error envelope shape", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/fail" });
  assert.equal(res.statusCode, 404);
  const body = res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, "RESOURCE_NOT_FOUND");
  assert.equal(body.error.message, "Missing.");
  assert.equal(body.error.fields, undefined);
  await app.close();
});

test("correlation id: incoming valid id echoed", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/ping",
    headers: { "x-request-id": "req-abc-123" },
  });
  assert.equal(res.json().meta.requestId, "req-abc-123");
  await app.close();
});

test("correlation id: invalid replaced by default", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/ping",
    headers: { "x-request-id": "bad id with spaces!" },
  });
  const id = res.json().meta.requestId;
  assert.notEqual(id, "bad id with spaces!");
  assert.match(id, /^[0-9a-f-]{36}$/);
  await app.close();
});

test("content negotiation: unacceptable Accept → 406", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/ping",
    headers: { accept: "text/html" },
  });
  assert.equal(res.statusCode, 406);
  assert.equal(res.json().error.code, "NOT_ACCEPTABLE");
  await app.close();
});

test("content negotiation: wildcard Accept → 200", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/ping",
    headers: { accept: "*/*" },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("content negotiation: POST without Content-Type → 415", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url: "/echo" });
  assert.equal(res.statusCode, 415);
  assert.equal(res.json().error.code, "UNSUPPORTED_MEDIA_TYPE");
  await app.close();
});

test("CSRF: bootstrap issues token, POST without token → 403 CSRF_HEADER_MISSING", async () => {
  const app = await buildApp({ csrf: { enabled: true } });
  const boot = await app.inject({
    method: "GET",
    url: "/api/csrf",
    headers: { "x-test-subject": "user-1" },
  });
  assert.equal(boot.statusCode, 200);
  assert.equal(boot.headers["cache-control"], "no-store");
  const token = boot.json().data.token;
  assert.ok(token);

  const noToken = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "x-test-subject": "user-1", "content-type": "application/json" },
    payload: {},
  });
  assert.equal(noToken.statusCode, 403);
  assert.equal(noToken.json().error.code, "CSRF_HEADER_MISSING");

  const withToken = await app.inject({
    method: "POST",
    url: "/echo",
    headers: {
      "x-test-subject": "user-1",
      "content-type": "application/json",
      "x-csrf-token": token,
    },
    payload: {},
  });
  assert.equal(withToken.statusCode, 200);
  await app.close();
});

test("CSRF: token bound to subject — different subject rejected", async () => {
  const app = await buildApp({ csrf: { enabled: true } });
  const boot = await app.inject({
    method: "GET",
    url: "/api/csrf",
    headers: { "x-test-subject": "user-1" },
  });
  const token = boot.json().data.token;

  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: {
      "x-test-subject": "user-2",
      "content-type": "application/json",
      "x-csrf-token": token,
    },
    payload: {},
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, "CSRF_TOKEN_INVALID");
  await app.close();
});

test("origin policy: rejects disallowed origin on POST", async () => {
  const app = await buildApp({
    csrf: { enabled: false },
    origin: { enabled: true, allowedOrigins: ["https://app.example.com"] },
  });
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { origin: "https://evil.example.com", "content-type": "application/json" },
    payload: {},
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, "CSRF_ORIGIN_REJECTED");
  await app.close();
});

test("origin policy: allows matching origin", async () => {
  const app = await buildApp({
    csrf: { enabled: false },
    origin: { enabled: true, allowedOrigins: ["https://app.example.com"] },
  });
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { origin: "https://app.example.com", "content-type": "application/json" },
    payload: {},
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("unhandled exception → INTERNAL_ERROR 500 safe message", async () => {
  const app = await buildApp({}, async (a) => {
    a.get("/boom", async () => {
      throw new Error("secret internals");
    });
  });
  const res = await app.inject({ method: "GET", url: "/boom" });
  assert.equal(res.statusCode, 500);
  const body = res.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.message, "An unexpected error occurred.");
  await app.close();
});

// ---------------------------------------------------------------------------
// Expanded integration scenarios (mirroring C# integration tests)
// ---------------------------------------------------------------------------

test("correlation: reject policy → 400 VALIDATION_ERROR", async () => {
  const app = await buildApp({
    correlation: { invalidIdPolicy: "reject" },
  });
  const res = await app.inject({
    method: "GET",
    url: "/ping",
    headers: { "x-request-id": "bad id with spaces!" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "VALIDATION_ERROR");
  await app.close();
});

test("correlation: generated id is GUIDv7", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/ping" });
  const id = res.json().meta.requestId;
  assert.equal(id.length, 36);
  assert.equal(id[14], "7");
  await app.close();
});

test("correlation: custom header name", async () => {
  const app = await buildApp({ correlation: { headerName: "X-Correlation-Id" } });
  const res = await app.inject({
    method: "GET",
    url: "/ping",
    headers: { "x-correlation-id": "corr-12345" },
  });
  assert.equal(res.json().meta.requestId, "corr-12345");
  assert.equal(res.headers["x-correlation-id"], "corr-12345");
  assert.equal(res.headers["x-request-id"], undefined);
  await app.close();
});

test("content negotiation: POST without Content-Type → 415 required message", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "" },
    payload: "{}",
  });
  assert.equal(res.statusCode, 415);
  assert.match(res.json().error.message, /required/i);
  await app.close();
});

test("origin: missing Origin + requireOriginHeader → 403", async () => {
  const app = await buildApp({
    csrf: { enabled: false },
    origin: {
      enabled: true,
      allowedOrigins: ["https://app.example.com"],
      requireOriginHeader: true,
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "application/json" },
    payload: {},
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("origin: Referer fallback allows matching origin", async () => {
  const app = await buildApp({
    csrf: { enabled: false },
    origin: {
      enabled: true,
      allowedOrigins: ["https://app.example.com"],
      requireOriginHeader: true,
      allowRefererFallback: true,
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: {
      "content-type": "application/json",
      referer: "https://app.example.com/some/page",
    },
    payload: {},
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("origin: safe method skips origin check", async () => {
  const app = await buildApp({
    csrf: { enabled: false },
    origin: {
      enabled: true,
      allowedOrigins: ["https://app.example.com"],
      requireOriginHeader: true,
    },
  });
  const res = await app.inject({
    method: "GET",
    url: "/ping",
    headers: { origin: "https://evil.com" },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("fetch metadata: strict rejects cross-site", async () => {
  const app = await buildApp({
    csrf: { enabled: false },
    fetchMetadata: { profile: "strict" },
  });
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "cross-site",
    },
    payload: {},
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, "CSRF_ORIGIN_REJECTED");
  await app.close();
});

test("fetch metadata: strict allows same-origin", async () => {
  const app = await buildApp({
    csrf: { enabled: false },
    fetchMetadata: { profile: "strict" },
  });
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
    },
    payload: {},
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("CSRF: safe method skips validation", async () => {
  const app = await buildApp({ csrf: { enabled: true } });
  const res = await app.inject({ method: "GET", url: "/ping" });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("CSRF: tampered token rejected", async () => {
  const app = await buildApp({ csrf: { enabled: true } });
  const boot = await app.inject({
    method: "GET",
    url: "/api/csrf",
    headers: { "x-test-subject": "user-1" },
  });
  const token = boot.json().data.token;
  const tampered = token.slice(0, -5) + "X" + token.slice(-4);
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: {
      "x-test-subject": "user-1",
      "content-type": "application/json",
      "x-csrf-token": tampered,
    },
    payload: {},
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, "CSRF_TOKEN_INVALID");
  await app.close();
});

test("CSRF: bootstrap path exempt on POST (404 not 403)", async () => {
  const app = await buildApp({ csrf: { enabled: true } });
  const res = await app.inject({
    method: "POST",
    url: "/api/csrf",
    headers: { "content-type": "application/json" },
    payload: {},
  });
  assert.notEqual(res.statusCode, 403);
  await app.close();
});

test("CSRF: custom header name", async () => {
  const app = await buildApp({ csrf: { enabled: true, headerName: "X-XSRF-TOKEN" } });
  const boot = await app.inject({
    method: "GET",
    url: "/api/csrf",
    headers: { "x-test-subject": "user-1" },
  });
  const token = boot.json().data.token;
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: {
      "x-test-subject": "user-1",
      "content-type": "application/json",
      "x-xsrf-token": token,
    },
    payload: {},
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("CSRF: custom protected methods — POST unprotected, DELETE protected", async () => {
  const app = await buildApp(
    { csrf: { enabled: true, protectedMethods: ["DELETE"] } },
    async (a) => {
      a.post("/echo", async (req, reply) => sendSuccess(req, reply, { ok: true }));
      a.delete("/item/:id", async (req, reply) => sendSuccess(req, reply, { ok: true }));
    },
  );
  const post = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "application/json" },
    payload: {},
  });
  assert.equal(post.statusCode, 200);
  const del = await app.inject({ method: "DELETE", url: "/item/1" });
  assert.equal(del.statusCode, 403);
  await app.close();
});

test("CSRF: no binding → bootstrap 403 (fail closed)", async () => {
  const app = Fastify();
  await app.register(apipilotPlugin, {
    csrf: { enabled: true },
    csrfKeyRing: keyRing,
    csrfBinding: {}, // no extractors → binding always null
  });
  app.get("/ping", async (req, reply) => sendSuccess(req, reply, { pong: true }));
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/csrf" });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("exception: custom mapper wins", async () => {
  const app = await buildApp(
    {
      exceptionMappers: [
        (e) => e.message === "quota exceeded"
          ? { code: "QUOTA_EXCEEDED", message: "Quota exceeded." }
          : null,
      ],
    },
    async (a) => {
      a.get("/boom", async () => {
        throw new Error("quota exceeded");
      });
    },
  );
  const res = await app.inject({ method: "GET", url: "/boom" });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, "QUOTA_EXCEEDED");
  await app.close();
});

test("exception: revealExceptionMessage echoes message", async () => {
  const app = await buildApp(
    { exceptions: { revealExceptionMessage: true } },
    async (a) => {
      a.get("/boom", async () => {
        throw new Error("sensitive detail");
      });
    },
  );
  const res = await app.inject({ method: "GET", url: "/boom" });
  assert.equal(res.json().error.message, "sensitive detail");
  await app.close();
});

test("pagination: sort + filter parsed on route", async () => {
  const { paginationHook, getPagination } = await import("../dist/index.js");
  const app = await buildApp({}, async (a) => {
    a.get("/items", { preHandler: paginationHook({}) }, async (req, reply) => {
      const p = getPagination(req);
      if (!p || p.sort?.field !== "name" || p.sort?.direction !== "desc") {
        return reply.status(500).send({ bad: "sort" });
      }
      if (p.filter?.parameters.status !== "active") {
        return reply.status(500).send({ bad: "filter" });
      }
      return sendSuccess(req, reply, { ok: true });
    });
  });
  const res = await app.inject({
    method: "GET",
    url: "/items?sort=name&direction=desc&status=active",
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("pagination: invalid pageSize → 400 VALIDATION_ERROR", async () => {
  const { paginationHook } = await import("../dist/index.js");
  const app = await buildApp({}, async (a) => {
    a.get("/items", { preHandler: paginationHook({}) }, async (req, reply) =>
      sendSuccess(req, reply, { ok: true }));
  });
  const res = await app.inject({ method: "GET", url: "/items?pageSize=500" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "VALIDATION_ERROR");
  await app.close();
});

test("correlation id carried in CSRF error envelope", async () => {
  const app = await buildApp({ csrf: { enabled: true } });
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: {
      "content-type": "application/json",
      "x-request-id": "corr-fixed-123",
    },
    payload: {},
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().meta.requestId, "corr-fixed-123");
  await app.close();
});

test("rate limit: allows up to limit then 429 RATE_LIMITED", async () => {
  const app = await buildApp({
    rateLimit: { enabled: true, requestsPerWindow: 2, windowSeconds: 60 },
  });
  for (let i = 0; i < 2; i++) {
    const res = await app.inject({ method: "GET", url: "/ping" });
    assert.equal(res.statusCode, 200);
  }
  const res = await app.inject({ method: "GET", url: "/ping" });
  assert.equal(res.statusCode, 429);
  assert.ok(res.headers["retry-after"]);
  const body = res.json();
  assert.equal(body.error.code, "RATE_LIMITED");
  assert.equal(body.error.message, "Too many requests. Retry later.");
  await app.close();
});

test("rate limit: disabled by default", async () => {
  const app = await buildApp();
  for (let i = 0; i < 10; i++) {
    const res = await app.inject({ method: "GET", url: "/ping" });
    assert.equal(res.statusCode, 200);
  }
  await app.close();
});

test("rate limit: custom key extractor isolates users", async () => {
  const app = await buildApp({
    rateLimit: {
      enabled: true,
      requestsPerWindow: 1,
      windowSeconds: 60,
      keyExtractor: (req) => req.headers["x-user"] ?? "anon",
    },
  });
  for (const user of ["alice", "bob"]) {
    const res = await app.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-user": user },
    });
    assert.equal(res.statusCode, 200);
  }
  const res = await app.inject({
    method: "GET",
    url: "/ping",
    headers: { "x-user": "alice" },
  });
  assert.equal(res.statusCode, 429);
  await app.close();
});

test("rate limit: custom message and no Retry-After", async () => {
  const app = await buildApp({
    rateLimit: {
      enabled: true,
      requestsPerWindow: 1,
      windowSeconds: 60,
      message: "Slow down.",
      setRetryAfterHeader: false,
    },
  });
  await app.inject({ method: "GET", url: "/ping" });
  const res = await app.inject({ method: "GET", url: "/ping" });
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error.message, "Slow down.");
  assert.equal(res.headers["retry-after"], undefined);
  await app.close();
});

test("diagnostics: csrf-no-binding warning", async () => {
  const { diagnostics, resolveOptions, DefaultCsrfBindingResolver } = await import("../dist/index.js");
  const options = resolveOptions({ csrf: { enabled: true } });
  const diags = diagnostics(options, new DefaultCsrfBindingResolver({}));
  assert.ok(diags.some((d) => d.code === "csrf-no-binding" && d.level === "warning"));
});

test("diagnostics: binding configured suppresses warning", async () => {
  const { diagnostics, resolveOptions, DefaultCsrfBindingResolver } = await import("../dist/index.js");
  const options = resolveOptions({ csrf: { enabled: true } });
  const binding = new DefaultCsrfBindingResolver({
    subjectExtractor: () => "u",
  });
  const diags = diagnostics(options, binding);
  assert.ok(!diags.some((d) => d.code === "csrf-no-binding"));
});

test("diagnostics: origin empty allowlist warning", async () => {
  const { diagnostics, resolveOptions } = await import("../dist/index.js");
  const options = resolveOptions({ origin: { enabled: true, allowedOrigins: [] } });
  const diags = diagnostics(options);
  assert.ok(diags.some((d) => d.code === "origin-empty-allowlist"));
});

test("diagnostics: clean config returns empty", async () => {
  const { diagnostics, resolveOptions } = await import("../dist/index.js");
  assert.deepEqual(diagnostics(resolveOptions()), []);
});

test("openapi: error schemas shape", async () => {
  const { errorSchemas, ERROR_ENVELOPE_SCHEMA_NAME, ERROR_OBJECT_SCHEMA_NAME, ERROR_FIELDS_SCHEMA_NAME } =
    await import("../dist/index.js");
  const schemas = errorSchemas();
  assert.equal(Object.keys(schemas).length, 3);
  const env = schemas[ERROR_ENVELOPE_SCHEMA_NAME];
  assert.deepEqual(env.properties.success.enum, [false]);
  assert.deepEqual(env.required.sort(), ["error", "success"]);
  const obj = schemas[ERROR_OBJECT_SCHEMA_NAME];
  assert.ok("fields" in obj.properties);
  const fields = schemas[ERROR_FIELDS_SCHEMA_NAME];
  assert.equal(fields.additionalProperties.type, "array");
});
