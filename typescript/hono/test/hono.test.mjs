// @apipilot/hono tests — exercises the full pipeline via app.request().
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  apiPilotHono,
  apiPilotHonoErrorHandler,
  getPagination,
  getRequestId,
  paginatedResponse,
  sendError,
  sendSuccess,
} from "../dist/index.js";
import { generateKeyMaterial } from "@apipilot/node";

function makeApp(options = {}) {
  const app = new Hono();
  app.use(apiPilotHono({
    csrfKeyRing: {
      activeKeyId: "k1",
      keys: { k1: Buffer.from(generateKeyMaterial(), "base64") },
    },
    csrf: { enabled: true },
    csrfBinding: {
      preAuthSource: (c) => c.req.header("x-client-id") ?? null,
    },
    paginationEnabled: true,
    ...options,
  }));
  app.get("/health", (c) => sendSuccess(c, { status: "ok" }));
  app.get("/items", (c) => {
    const p = getPagination(c);
    return sendSuccess(c, { page: p?.pageRequest.page ?? null });
  });
  app.post("/items", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return sendSuccess(c, { created: body }, { status: 201 });
  });
  app.get("/paged", (c) => paginatedResponse(c, [1, 2, 3], 3, 1, 20));
  app.get("/boom", () => {
    const err = new Error("boom");
    err.statusCode = 404;
    throw err;
  });
  app.onError(apiPilotHonoErrorHandler());
  return app;
}

const headers = { "x-client-id": "demo", accept: "application/json" };

test("health returns success envelope with correlation id", async () => {
  const res = await makeApp().request("/health", { headers });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.status, "ok");
  assert.ok(body.meta.requestId);
  assert.ok(res.headers.get("x-request-id"));
});

test("CSRF bootstrap issues token", async () => {
  const res = await makeApp().request("/api/csrf", { headers });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.match(body.data.token, /^v1\.k1\./);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("POST without CSRF token is rejected", async () => {
  const res = await makeApp().request("/items", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ a: 1 }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, "CSRF_HEADER_MISSING");
});

test("POST with valid CSRF token succeeds", async () => {
  const app = makeApp();
  const boot = await app.request("/api/csrf", { headers });
  const { token } = (await boot.json()).data;
  const res = await app.request("/items", {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
      "x-csrf-token": token,
    },
    body: JSON.stringify({ a: 1 }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.data.created, { a: 1 });
});

test("pagination query is parsed and exposed via getPagination", async () => {
  const res = await makeApp().request("/items?page=3&pageSize=10", { headers });
  const body = await res.json();
  assert.equal(body.data.page, 3);
});

test("invalid pagination rejected with VALIDATION_ERROR", async () => {
  const res = await makeApp().request("/items?page=0", { headers });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("paginatedResponse emits pagination block", async () => {
  const res = await makeApp().request("/paged", { headers });
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.pagination);
  assert.equal(body.pagination.totalItems, 3);
});

test("thrown 404 maps to RESOURCE_NOT_FOUND envelope", async () => {
  const res = await makeApp().request("/boom", { headers });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "RESOURCE_NOT_FOUND");
});

test("getRequestId returns correlation id inside handler", async () => {
  const app = new Hono();
  let seen = null;
  app.use(apiPilotHono());
  app.get("/rid", (c) => {
    seen = getRequestId(c);
    return sendSuccess(c, { ok: true });
  });
  await app.request("/rid");
  assert.ok(seen);
});
