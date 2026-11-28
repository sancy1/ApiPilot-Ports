// Consumer CDCT for @apipilot/node — the shared consumer app from
// conformance/consumer/README.md. Every scenario must produce identical
// wire behavior on every port.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import {
  apiPilot,
  apiPilotErrorHandler,
  getPagination,
  getRequestId,
  sendError,
  sendSuccess,
  sendValidationError,
  generateKeyMaterial,
} from "../dist/index.js";

const keyRing = {
  activeKeyId: "k1",
  keys: { k1: Buffer.from(generateKeyMaterial(), "base64") },
};

function startServer(mw, handler) {
  const server = createServer((req, res) => {
    mw(req, res, () => handler(req, res));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function stop(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function req(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const rq = request(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    rq.on("error", reject);
    if (body) rq.write(body);
    rq.end();
  });
}

// --- The shared consumer app -------------------------------------------------

function consumerHandler(req, res) {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") {
    return sendSuccess(req, res, { status: "ok" });
  }
  if (url.pathname === "/items") {
    const p = getPagination(req);
    return sendSuccess(req, res, {
      page: p?.pageRequest.page ?? null,
      pageSize: p?.pageRequest.pageSize ?? null,
    });
  }
  if (url.pathname === "/fail") {
    return sendError(req, res, "RESOURCE_NOT_FOUND", "Item not found.");
  }
  if (url.pathname === "/validate") {
    return sendValidationError(req, res, { page: ["must be an integer"] });
  }
  if (url.pathname === "/echo" && req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () =>
      sendSuccess(req, res, { echo: Buffer.concat(chunks).toString("utf8") }),
    );
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "no route" }));
}

function consumerMw() {
  return apiPilot({
    csrf: { enabled: true, rotationRequirement: "optional" },
    csrfKeyRing: keyRing,
    csrfBinding: {
      sessionExtractor: (req) => req.headers["x-session-id"] ?? null,
    },
    origin: { enabled: true, allowedOrigins: ["https://app.example.com"] },
    paginationEnabled: true,
    fetchMetadata: { profile: "strict" },
  });
}

// --- Scenarios ----------------------------------------------------------------

test("S1: correlation id + success envelope", async () => {
  const server = await startServer(consumerMw(), consumerHandler);
  const port = server.address().port;
  const r = await req(port, "/health");
  assert.equal(r.status, 200);
  const corrId = r.headers["x-request-id"];
  assert.ok(corrId, "x-request-id header missing");
  const body = JSON.parse(r.body);
  assert.equal(body.success, true);
  assert.equal(body.meta.requestId, corrId);
  await stop(server);
});

test("S2: pagination context reaches handler", async () => {
  const server = await startServer(consumerMw(), consumerHandler);
  const port = server.address().port;
  const r = await req(port, "/items?page=2&pageSize=5");
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.data.page, 2);
  assert.equal(body.data.pageSize, 5);
  await stop(server);
});

test("S3: invalid pagination → VALIDATION_ERROR envelope", async () => {
  const server = await startServer(consumerMw(), consumerHandler);
  const port = server.address().port;
  const r = await req(port, "/items?page=abc");
  assert.equal(r.status, 400);
  const body = JSON.parse(r.body);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.ok(body.error.fields?.page, "fields.page missing");
  await stop(server);
});

test("S4: handler error → RESOURCE_NOT_FOUND envelope", async () => {
  const server = await startServer(consumerMw(), consumerHandler);
  const port = server.address().port;
  const r = await req(port, "/fail");
  assert.equal(r.status, 404);
  assert.equal(JSON.parse(r.body).error.code, "RESOURCE_NOT_FOUND");
  await stop(server);
});

test("S5: disallowed Origin → CSRF_ORIGIN_REJECTED", async () => {
  const server = await startServer(consumerMw(), consumerHandler);
  const port = server.address().port;
  const r = await req(port, "/echo", {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "content-type": "application/json",
      "x-session-id": "sess-1",
    },
    body: "{}",
  });
  assert.equal(r.status, 403);
  assert.equal(JSON.parse(r.body).error.code, "CSRF_ORIGIN_REJECTED");
  await stop(server);
});

test("S6: CSRF bootstrap → protected POST flow", async () => {
  const server = await startServer(consumerMw(), consumerHandler);
  const port = server.address().port;
  const session = { "x-session-id": "sess-cdct" };

  const boot = await req(port, "/api/csrf", { headers: session });
  assert.equal(boot.status, 200);
  const token = JSON.parse(boot.body).data.token;
  assert.ok(token);

  const noToken = await req(port, "/echo", {
    method: "POST",
    headers: {
      ...session,
      origin: "https://app.example.com",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(noToken.status, 403);
  assert.match(JSON.parse(noToken.body).error.code, /^CSRF_/);

  const withToken = await req(port, "/echo", {
    method: "POST",
    headers: {
      ...session,
      origin: "https://app.example.com",
      "content-type": "application/json",
      "x-csrf-token": token,
    },
    body: "{}",
  });
  assert.equal(withToken.status, 200);
  await stop(server);
});

test("S7: Sec-Fetch-Site cross-site → rejected (strict)", async () => {
  const server = await startServer(consumerMw(), consumerHandler);
  const port = server.address().port;
  const r = await req(port, "/echo", {
    method: "POST",
    headers: {
      origin: "https://app.example.com",
      "sec-fetch-site": "cross-site",
      "content-type": "application/json",
      "x-session-id": "sess-fm",
    },
    body: "{}",
  });
  // Strict profile fails closed on cross-site unsafe requests.
  assert.equal(r.status, 403);
  await stop(server);
});
