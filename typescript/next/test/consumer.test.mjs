// Consumer CDCT for @apipilot/next — shared consumer app scenarios.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiError,
  apiSuccess,
  apiValidationError,
  getPagination,
  getRequestId,
  withApiPilot,
} from "../dist/index.js";
import { generateKeyMaterial } from "@apipilot/node";

const keyRing = {
  activeKeyId: "k1",
  keys: { k1: Buffer.from(generateKeyMaterial(), "base64") },
};

function makeHandler() {
  return withApiPilot(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") return apiSuccess({ status: "ok" }, req);
    if (url.pathname === "/items") {
      const p = getPagination(req);
      return apiSuccess(
        { page: p?.pageRequest.page ?? null, pageSize: p?.pageRequest.pageSize ?? null },
        req,
      );
    }
    if (url.pathname === "/fail") {
      return apiError("RESOURCE_NOT_FOUND", "Item not found.", req);
    }
    if (url.pathname === "/validate") {
      return apiValidationError({ page: ["must be an integer"] }, req);
    }
    if (url.pathname === "/echo" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      return apiSuccess({ echo: body }, req);
    }
    return apiError("RESOURCE_NOT_FOUND", "not found", req);
  }, {
    csrf: { enabled: true, rotationRequirement: "optional" },
    csrfKeyRing: keyRing,
    csrfBinding: {
      preAuthSource: (req) => req.headers.get("x-session-id"),
    },
    origin: { enabled: true, allowedOrigins: ["https://app.example.com"] },
    paginationEnabled: true,
    fetchMetadata: { profile: "strict" },
  });
}

const session = { "x-session-id": "sess-cdct" };
const req = (path, init = {}) =>
  new Request(`http://localhost${path}`, {
    ...init,
    headers: { accept: "application/json", ...session, ...(init.headers ?? {}) },
  });

test("S1: correlation id + success envelope", async () => {
  const res = await makeHandler()(req("/health"));
  assert.equal(res.status, 200);
  const corrId = res.headers.get("x-request-id");
  assert.ok(corrId);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.meta.requestId, corrId);
});

test("S2: pagination context reaches handler", async () => {
  const res = await makeHandler()(req("/items?page=2&pageSize=5"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.page, 2);
  assert.equal(body.data.pageSize, 5);
});

test("S3: invalid pagination → VALIDATION_ERROR envelope", async () => {
  const res = await makeHandler()(req("/items?page=abc"));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.ok(body.error.fields?.page);
});

test("S4: handler error → RESOURCE_NOT_FOUND envelope", async () => {
  const res = await makeHandler()(req("/fail"));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, "RESOURCE_NOT_FOUND");
});

test("S5: disallowed Origin → CSRF_ORIGIN_REJECTED", async () => {
  const res = await makeHandler()(req("/echo", {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "content-type": "application/json",
    },
    body: "{}",
  }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, "CSRF_ORIGIN_REJECTED");
});

test("S6: CSRF bootstrap → protected POST flow", async () => {
  const handler = makeHandler();
  const boot = await handler(req("/api/csrf"));
  assert.equal(boot.status, 200);
  const token = (await boot.json()).data.token;
  assert.ok(token);

  const noToken = await handler(req("/echo", {
    method: "POST",
    headers: { origin: "https://app.example.com", "content-type": "application/json" },
    body: "{}",
  }));
  assert.equal(noToken.status, 403);
  assert.match((await noToken.json()).error.code, /^CSRF_/);

  const withToken = await handler(req("/echo", {
    method: "POST",
    headers: {
      origin: "https://app.example.com",
      "content-type": "application/json",
      "x-csrf-token": token,
    },
    body: "{}",
  }));
  assert.equal(withToken.status, 200);
});

test("S7: Sec-Fetch-Site cross-site → rejected (strict)", async () => {
  const res = await makeHandler()(req("/echo", {
    method: "POST",
    headers: {
      origin: "https://app.example.com",
      "content-type": "application/json",
      "sec-fetch-site": "cross-site",
    },
    body: "{}",
  }));
  assert.equal(res.status, 403);
});
