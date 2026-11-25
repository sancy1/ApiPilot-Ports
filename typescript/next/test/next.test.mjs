// @apipilot/next tests — App Router handlers exercised via web Request.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiError,
  apiPaginatedResponse,
  apiSuccess,
  apiValidationError,
  getPagination,
  getRequestId,
  withApiPilot,
  withApiPilotPages,
} from "../dist/index.js";
import { generateKeyMaterial } from "@apipilot/node";

const keyRing = {
  activeKeyId: "k1",
  keys: { k1: Buffer.from(generateKeyMaterial(), "base64") },
};

function makeHandler(options = {}) {
  return withApiPilot(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") return apiSuccess({ status: "ok" }, req);
    if (url.pathname === "/items") {
      const p = getPagination(req);
      return apiSuccess({ page: p?.pageRequest.page ?? null }, req);
    }
    if (url.pathname === "/paged") {
      return apiPaginatedResponse([1, 2, 3], 3, 1, 20, req);
    }
    if (url.pathname === "/boom") {
      const err = new Error("boom");
      err.statusCode = 404;
      throw err;
    }
    if (url.pathname === "/rid") {
      return apiSuccess({ rid: getRequestId(req) }, req);
    }
    return apiError("RESOURCE_NOT_FOUND", "not found", req);
  }, {
    csrfKeyRing: keyRing,
    csrf: { enabled: true },
    csrfBinding: {
      preAuthSource: (req) => req.headers.get("x-client-id"),
    },
    paginationEnabled: true,
    ...options,
  });
}

const headers = { "x-client-id": "demo", accept: "application/json" };
const req = (path, init = {}) =>
  new Request(`http://localhost${path}`, { headers, ...init });

test("health returns success envelope with correlation id", async () => {
  const res = await makeHandler()(req("/health"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.status, "ok");
  assert.ok(body.meta.requestId);
  assert.ok(res.headers.get("x-request-id"));
});

test("CSRF bootstrap issues token", async () => {
  const res = await makeHandler()(req("/api/csrf"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.match(body.data.token, /^v1\.k1\./);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("POST without CSRF token is rejected", async () => {
  const res = await makeHandler()(req("/items", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ a: 1 }),
  }));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, "CSRF_HEADER_MISSING");
});

test("POST with valid CSRF token reaches handler", async () => {
  const handler = makeHandler();
  const boot = await handler(req("/api/csrf"));
  const { token } = (await boot.json()).data;
  const res = await handler(req("/submit", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "x-csrf-token": token },
    body: JSON.stringify({ a: 1 }),
  }));
  // Pipeline passed → handler ran → unmatched path → 404 envelope.
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "RESOURCE_NOT_FOUND");
});

test("pagination query parsed via getPagination", async () => {
  const res = await makeHandler()(req("/items?page=3&pageSize=10"));
  const body = await res.json();
  assert.equal(body.data.page, 3);
});

test("invalid pagination rejected", async () => {
  const res = await makeHandler()(req("/items?page=0"));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("apiPaginatedResponse emits pagination block", async () => {
  const res = await makeHandler()(req("/paged"));
  const body = await res.json();
  assert.ok(body.pagination);
  assert.equal(body.pagination.totalItems, 3);
});

test("thrown 404 maps to RESOURCE_NOT_FOUND envelope", async () => {
  const res = await makeHandler()(req("/boom"));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "RESOURCE_NOT_FOUND");
});

test("getRequestId returns correlation id", async () => {
  const res = await makeHandler()(req("/rid"));
  const body = await res.json();
  assert.ok(body.data.rid);
});

test("withApiPilotPages is the node adapter wrapper", () => {
  assert.equal(typeof withApiPilotPages, "function");
});

test("apiValidationError helper", async () => {
  const handler = withApiPilot(async (r) => apiValidationError({ name: ["required"] }, r));
  const res = await handler(req("/x"));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.deepEqual(body.error.fields, { name: ["required"] });
});
