// Consumer CDCT for @apipilot/fastify — shared consumer app scenarios.
import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  apipilotPlugin,
  generateKeyMaterial,
  sendSuccess,
  sendError,
  sendValidationError,
  getPagination,
  paginationHook,
} from "../dist/index.js";
import { ApiErrorCode } from "@apipilot/core";

const keyRing = {
  activeKeyId: "k1",
  keys: { k1: Buffer.from(generateKeyMaterial(), "base64") },
};

async function buildApp() {
  const app = Fastify();
  await app.register(apipilotPlugin, {
    csrf: { enabled: true, rotationRequirement: "optional" },
    csrfKeyRing: keyRing,
    csrfBinding: {
      subjectExtractor: (req) => req.headers["x-session-id"] ?? null,
    },
    origin: { enabled: true, allowedOrigins: ["https://app.example.com"] },
    fetchMetadata: { profile: "strict" },
  });
  app.get("/health", async (req, reply) => sendSuccess(req, reply, { status: "ok" }));
  app.get("/items", { preHandler: paginationHook() }, async (req, reply) => {
    const p = getPagination(req);
    return sendSuccess(req, reply, {
      page: p?.pageRequest.page ?? null,
      pageSize: p?.pageRequest.pageSize ?? null,
    });
  });
  app.get("/fail", async (req, reply) =>
    sendError(req, reply, ApiErrorCode.ResourceNotFound, "Item not found."),
  );
  app.get("/validate", async (req, reply) =>
    sendValidationError(req, reply, { page: ["must be an integer"] }),
  );
  app.post("/echo", async (req, reply) =>
    sendSuccess(req, reply, { echo: req.body ?? null }),
  );
  await app.ready();
  return app;
}

test("S1: correlation id + success envelope", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  const corrId = res.headers["x-request-id"];
  assert.ok(corrId);
  const body = res.json();
  assert.equal(body.success, true);
  assert.equal(body.meta.requestId, corrId);
  await app.close();
});

test("S2: pagination context reaches handler", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/items?page=2&pageSize=5" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.data.page, 2);
  assert.equal(body.data.pageSize, 5);
  await app.close();
});

test("S3: invalid pagination → VALIDATION_ERROR envelope", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/items?page=abc" });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.ok(body.error.fields?.page);
  await app.close();
});

test("S4: handler error → RESOURCE_NOT_FOUND envelope", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/fail" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, "RESOURCE_NOT_FOUND");
  await app.close();
});

test("S5: disallowed Origin → CSRF_ORIGIN_REJECTED", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: {
      origin: "https://evil.example",
      "content-type": "application/json",
      "x-session-id": "sess-1",
    },
    payload: {},
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, "CSRF_ORIGIN_REJECTED");
  await app.close();
});

test("S6: CSRF bootstrap → protected POST flow", async () => {
  const app = await buildApp();
  const session = { "x-session-id": "sess-cdct" };

  const boot = await app.inject({ method: "GET", url: "/api/csrf", headers: session });
  assert.equal(boot.statusCode, 200);
  const token = boot.json().data.token;
  assert.ok(token);

  const noToken = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { ...session, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(noToken.statusCode, 403);
  assert.match(noToken.json().error.code, /^CSRF_/);

  const withToken = await app.inject({
    method: "POST",
    url: "/echo",
    headers: {
      ...session,
      "content-type": "application/json",
      "x-csrf-token": token,
    },
    payload: {},
  });
  assert.equal(withToken.statusCode, 200);
  await app.close();
});

test("S7: Sec-Fetch-Site cross-site → rejected (strict)", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: {
      "sec-fetch-site": "cross-site",
      "content-type": "application/json",
      "x-session-id": "sess-fm",
    },
    payload: {},
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});
