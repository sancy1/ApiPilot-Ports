// Adapter-level conformance — exercises @apipilot/node middleware over real
// HTTP and asserts the wire contracts defined by conformance/vectors/*.json
// (envelope, error-code, correlation-id, pagination, content-negotiation,
// origin, fetch-metadata, csrf-*). The core runner covers function-level
// vectors; this file proves the adapter emits identical wire shapes.
//
// Run: node --test test/conformance-adapter.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import {
  apiPilot,
  apiPilotErrorHandler,
  generateKeyMaterial,
  sendSuccess,
  Metrics,
} from "../dist/index.js";

const key = Buffer.from(generateKeyMaterial(), "base64");
const keyRing = { activeKeyId: "k1", keys: { k1: key } };

function startServer(mw, handler, errMw) {
  const server = createServer((req, res) => {
    mw(req, res, () => {
      try {
        handler(req, res);
      } catch (e) {
        if (errMw) errMw(e, req, res, () => {});
        else throw e;
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function stop(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function req(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const rq = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    rq.on("error", reject);
    if (body) rq.write(body);
    rq.end();
  });
}

const json = (res) => JSON.parse(res.body);
// Handlers must emit ApiPilot envelopes themselves (sendSuccess/sendError).
const okHandler = (req, res) => sendSuccess(req, res, { ok: true });

// ---------------------------------------------------------------------------
// envelope.json — wire shapes
// ---------------------------------------------------------------------------

test("conformance: success envelope keys pinned", async () => {
  const server = await startServer(apiPilot(), okHandler);
  const port = server.address().port;
  const res = await req(port, "/x");
  const body = json(res);
  assert.deepEqual(Object.keys(body).sort(), ["data", "message", "meta", "success"]);
  assert.equal(body.success, true);
  assert.equal(body.data.ok, true);
  assert.ok(typeof body.meta.requestId === "string" && body.meta.requestId.length > 0);
  await stop(server);
});

test("conformance: error envelope shape + no fields key for plain errors", async () => {
  const server = await startServer(
    apiPilot({ contentNegotiation: { enabled: true } }),
    okHandler,
  );
  const port = server.address().port;
  const res = await req(port, "/x", { headers: { accept: "application/xml" } });
  const body = json(res);
  assert.equal(body.success, false);
  assert.equal(body.error.code, "NOT_ACCEPTABLE");
  assert.equal(typeof body.error.message, "string");
  assert.ok(!("fields" in body.error));
  assert.ok(body.meta.requestId);
  await stop(server);
});

test("conformance: validation error carries error.fields", async () => {
  const server = await startServer(apiPilot({ paginationEnabled: true }), okHandler);
  const port = server.address().port;
  const res = await req(port, "/items?page=abc");
  const body = json(res);
  assert.equal(res.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.ok(body.error.fields && typeof body.error.fields === "object");
  await stop(server);
});

// ---------------------------------------------------------------------------
// error-code.json — status mapping
// ---------------------------------------------------------------------------

test("conformance: standard error codes map to SPEC statuses", async () => {
  const cases = [
    // [setup, request, expectedStatus, expectedCode]
    [
      { contentNegotiation: { enabled: true } },
      { headers: { accept: "application/xml" } },
      406, "NOT_ACCEPTABLE",
    ],
    [
      { contentNegotiation: { enabled: true } },
      { method: "POST", headers: { "content-type": "text/plain" }, body: "x" },
      415, "UNSUPPORTED_MEDIA_TYPE",
    ],
    [
      { rateLimit: { enabled: true, requestsPerWindow: 1, windowSeconds: 60 } },
      {},
      429, "RATE_LIMITED",
    ],
    [
      { origin: { enabled: true, allowedOrigins: ["https://ok.example"] } },
      { method: "POST", headers: { origin: "https://bad.example", "content-type": "application/json" }, body: "{}" },
      403, "CSRF_ORIGIN_REJECTED",
    ],
    [
      { fetchMetadata: { profile: "strict" } },
      { method: "POST", headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" }, body: "{}" },
      403, "CSRF_ORIGIN_REJECTED",
    ],
  ];

  for (const [opts, rq, status, code] of cases) {
    const server = await startServer(apiPilot(opts), okHandler);
    const port = server.address().port;
    // For rate-limit: first request consumes the window, second is rejected.
    if (code === "RATE_LIMITED") await req(port, "/x");
    const res = await req(port, "/x", rq);
    assert.equal(res.status, status, `${code} status`);
    assert.equal(json(res).error.code, code, `${code} code`);
    await stop(server);
  }
});

test("conformance: INTERNAL_ERROR via error handler is 500", async () => {
  const server = await startServer(
    apiPilot(),
    () => { throw new Error("boom"); },
    apiPilotErrorHandler(),
  );
  const port = server.address().port;
  const res = await req(port, "/x");
  assert.equal(res.status, 500);
  assert.equal(json(res).error.code, "INTERNAL_ERROR");
  await stop(server);
});

// ---------------------------------------------------------------------------
// correlation-id.json — wire behavior
// ---------------------------------------------------------------------------

test("conformance: valid incoming correlation id used + echoed", async () => {
  const server = await startServer(apiPilot(), okHandler);
  const port = server.address().port;
  const res = await req(port, "/x", { headers: { "x-request-id": "01JZX4K8Q2M9N3P5R7S9T1V3W5" } });
  assert.equal(json(res).meta.requestId, "01JZX4K8Q2M9N3P5R7S9T1V3W5");
  await stop(server);
});

test("conformance: absent correlation id generates guid", async () => {
  const server = await startServer(apiPilot(), okHandler);
  const port = server.address().port;
  const res = await req(port, "/x");
  const id = json(res).meta.requestId;
  assert.match(id, /^[0-9a-f-]{36}$/i);
  await stop(server);
});

test("conformance: invalid correlation id rejected under reject policy", async () => {
  const server = await startServer(
    apiPilot({ correlation: { invalidIdPolicy: "reject" } }),
    okHandler,
  );
  const port = server.address().port;
  const res = await req(port, "/x", { headers: { "x-request-id": "bad id!" } });
  assert.equal(res.status, 400);
  assert.equal(json(res).error.code, "VALIDATION_ERROR");
  await stop(server);
});

// ---------------------------------------------------------------------------
// pagination.json — wire behavior
// ---------------------------------------------------------------------------

test("conformance: pagination defaults + parse", async () => {
  const server = await startServer(apiPilot({ paginationEnabled: true }), okHandler);
  const port = server.address().port;
  const res = await req(port, "/items?page=2&pageSize=10");
  assert.equal(res.status, 200);
  await stop(server);
});

test("conformance: page below base → VALIDATION_ERROR", async () => {
  const server = await startServer(apiPilot({ paginationEnabled: true }), okHandler);
  const port = server.address().port;
  const res = await req(port, "/items?page=-1");
  assert.equal(res.status, 400);
  assert.equal(json(res).error.code, "VALIDATION_ERROR");
  await stop(server);
});

test("conformance: pageSize over max → VALIDATION_ERROR", async () => {
  const server = await startServer(
    apiPilot({ paginationEnabled: true, pagination: { maxPageSize: 100 } }),
    okHandler,
  );
  const port = server.address().port;
  const res = await req(port, "/items?pageSize=101");
  assert.equal(res.status, 400);
  assert.equal(json(res).error.code, "VALIDATION_ERROR");
  await stop(server);
});

// ---------------------------------------------------------------------------
// csrf — wire behavior
// ---------------------------------------------------------------------------

test("conformance: csrf bootstrap issues token envelope", async () => {
  const server = await startServer(
    apiPilot({
      csrf: { enabled: true },
      csrfKeyRing: keyRing,
      csrfBinding: { sessionExtractor: (req) => req.headers["x-session-id"] ?? null },
    }),
    okHandler,
  );
  const port = server.address().port;
  const res = await req(port, "/api/csrf", { headers: { "x-session-id": "s1" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  const body = json(res);
  assert.equal(body.success, true);
  assert.ok(typeof body.data.token === "string" && body.data.token.length > 20);
  await stop(server);
});

test("conformance: csrf missing header → CSRF_HEADER_MISSING 403", async () => {
  const server = await startServer(
    apiPilot({
      csrf: { enabled: true },
      csrfKeyRing: keyRing,
      csrfBinding: { sessionExtractor: (req) => req.headers["x-session-id"] ?? null },
    }),
    okHandler,
  );
  const port = server.address().port;
  const res = await req(port, "/submit", {
    method: "POST",
    headers: { "x-session-id": "s1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 403);
  assert.equal(json(res).error.code, "CSRF_HEADER_MISSING");
  await stop(server);
});

test("conformance: csrf invalid token → CSRF_TOKEN_INVALID 403", async () => {
  const server = await startServer(
    apiPilot({
      csrf: { enabled: true },
      csrfKeyRing: keyRing,
      csrfBinding: { sessionExtractor: (req) => req.headers["x-session-id"] ?? null },
    }),
    okHandler,
  );
  const port = server.address().port;
  const res = await req(port, "/submit", {
    method: "POST",
    headers: {
      "x-session-id": "s1",
      "content-type": "application/json",
      "x-csrf-token": "v1.k1.forged.token.here",
    },
    body: "{}",
  });
  assert.equal(res.status, 403);
  assert.equal(json(res).error.code, "CSRF_TOKEN_INVALID");
  await stop(server);
});

test("conformance: metrics counters record rejections", async () => {
  const metrics = new Metrics();
  const server = await startServer(
    apiPilot({
      metrics,
      contentNegotiation: { enabled: true },
      rateLimit: { enabled: true, requestsPerWindow: 1, windowSeconds: 60 },
    }),
    okHandler,
  );
  const port = server.address().port;
  await req(port, "/x"); // consumes rate window
  await req(port, "/x", { headers: { accept: "application/xml" } }); // 406? rate limit hits first → 429
  const snap = metrics.snapshot();
  assert.ok(snap["rate_limited"] >= 1);
  await stop(server);
});
