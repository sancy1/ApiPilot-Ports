// Consumer CDCT for @apipilot/hono — shared consumer app scenarios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  apiPilotHono,
  apiPilotHonoErrorHandler,
  getPagination,
  sendError,
  sendSuccess,
  sendValidationError,
} from "../dist/index.js";
import { generateKeyMaterial } from "@apipilot/node";
import { ApiErrorCode } from "@apipilot/core";

function makeApp() {
  const app = new Hono();
  app.use(
    apiPilotHono({
      csrf: { enabled: true, rotationRequirement: "optional" },
      csrfKeyRing: {
        activeKeyId: "k1",
        keys: { k1: Buffer.from(generateKeyMaterial(), "base64") },
      },
      csrfBinding: {
        sessionExtractor: (c) => c.req.header("x-session-id") ?? null,
      },
      origin: { enabled: true, allowedOrigins: ["https://app.example.com"] },
      paginationEnabled: true,
      fetchMetadata: { profile: "strict" },
    }),
  );
  app.get("/health", (c) => sendSuccess(c, { status: "ok" }));
  app.get("/items", (c) => {
    const p = getPagination(c);
    return sendSuccess(c, {
      page: p?.pageRequest.page ?? null,
      pageSize: p?.pageRequest.pageSize ?? null,
    });
  });
  app.get("/fail", (c) =>
    sendError(c, ApiErrorCode.ResourceNotFound, "Item not found."),
  );
  app.get("/validate", (c) =>
    sendValidationError(c, { page: ["must be an integer"] }),
  );
  app.post("/echo", async (c) => {
    const body = await c.req.json().catch(() => null);
    return sendSuccess(c, { echo: body });
  });
  app.onError(apiPilotHonoErrorHandler());
  return app;
}

const session = { "x-session-id": "sess-cdct" };

test("S1: correlation id + success envelope", async () => {
  const res = await makeApp().request("/health");
  assert.equal(res.status, 200);
  const corrId = res.headers.get("x-request-id");
  assert.ok(corrId);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.meta.requestId, corrId);
});

test("S2: pagination context reaches handler", async () => {
  const res = await makeApp().request("/items?page=2&pageSize=5");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.page, 2);
  assert.equal(body.data.pageSize, 5);
});

test("S3: invalid pagination → VALIDATION_ERROR envelope", async () => {
  const res = await makeApp().request("/items?page=abc");
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.ok(body.error.fields?.page);
});

test("S4: handler error → RESOURCE_NOT_FOUND envelope", async () => {
  const res = await makeApp().request("/fail");
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, "RESOURCE_NOT_FOUND");
});

test("S5: disallowed Origin → CSRF_ORIGIN_REJECTED", async () => {
  const res = await makeApp().request("/echo", {
    method: "POST",
    headers: {
      ...session,
      origin: "https://evil.example",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, "CSRF_ORIGIN_REJECTED");
});

test("S6: CSRF bootstrap → protected POST flow", async () => {
  const app = makeApp();
  const boot = await app.request("/api/csrf", { headers: session });
  assert.equal(boot.status, 200);
  const token = (await boot.json()).data.token;
  assert.ok(token);

  const noToken = await app.request("/echo", {
    method: "POST",
    headers: { ...session, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(noToken.status, 403);
  assert.match((await noToken.json()).error.code, /^CSRF_/);

  const withToken = await app.request("/echo", {
    method: "POST",
    headers: {
      ...session,
      "content-type": "application/json",
      "x-csrf-token": token,
    },
    body: "{}",
  });
  assert.equal(withToken.status, 200);
});

test("S7: Sec-Fetch-Site cross-site → rejected (strict)", async () => {
  const res = await makeApp().request("/echo", {
    method: "POST",
    headers: {
      ...session,
      "sec-fetch-site": "cross-site",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(res.status, 403);
});
