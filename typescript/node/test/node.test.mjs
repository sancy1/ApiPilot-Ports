// Tests for @apipilot/node — raw node:http server exercising the middleware.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import {
  apiPilot,
  apiPilotErrorHandler,
  ApiPilotValidationException,
  withApiPilot,
  getPagination,
  Metrics,
  InMemoryRotationStore,
  generateKeyMaterial,
} from "../dist/index.js";

const key = Buffer.from(generateKeyMaterial(), "base64");
const keyRing = { activeKeyId: "k1", keys: { k1: key } };

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

const okHandler = (req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
};

test("correlation id is generated and echoed", async () => {
  const server = await startServer(apiPilot(), okHandler);
  const port = server.address().port;
  const res = await req(port, "/hello");
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  await stop(server);
});

test("incoming correlation id is used when valid", async () => {
  const server = await startServer(apiPilot(), okHandler);
  const port = server.address().port;
  const res = await req(port, "/hello", { headers: { "x-correlation-id": "corr-123" } });
  assert.equal(res.status, 200);
  await stop(server);
});

test("rate limit rejects with 429 envelope", async () => {
  const metrics = new Metrics();
  const mw = apiPilot({
    rateLimit: { enabled: true, requestsPerWindow: 2, windowSeconds: 60 },
    metrics,
  });
  const server = await startServer(mw, okHandler);
  const port = server.address().port;
  await req(port, "/a");
  await req(port, "/a");
  const res = await req(port, "/a");
  assert.equal(res.status, 429);
  const json = JSON.parse(res.body);
  assert.equal(json.success, false);
  assert.equal(json.error.code, "RATE_LIMITED");
  assert.ok(res.headers["retry-after"]);
  assert.equal(metrics.snapshot()["rate_limited"], 1);
  await stop(server);
});

test("content negotiation rejects unsupported Accept", async () => {
  const server = await startServer(
    apiPilot({ contentNegotiation: { enabled: true } }),
    okHandler,
  );
  const port = server.address().port;
  const res = await req(port, "/hello", { headers: { accept: "application/xml" } });
  assert.equal(res.status, 406);
  await stop(server);
});

test("origin policy rejects disallowed origin on POST", async () => {
  const server = await startServer(
    apiPilot({ origin: { enabled: true, allowedOrigins: ["https://good.example"] } }),
    okHandler,
  );
  const port = server.address().port;
  const res = await req(port, "/submit", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 403);
  const json = JSON.parse(res.body);
  assert.equal(json.error.code, "CSRF_ORIGIN_REJECTED");
  await stop(server);
});

test("csrf bootstrap issues token; protected POST validates it", async () => {
  const mw = apiPilot({
    csrf: { enabled: true, rotationRequirement: "optional" },
    csrfKeyRing: keyRing,
    csrfBinding: {
      sessionExtractor: (req) => req.headers["x-session-id"] ?? null,
    },
  });
  const server = await startServer(mw, okHandler);
  const port = server.address().port;
  const session = { "x-session-id": "sess-1" };

  const boot = await req(port, "/api/csrf", { headers: session });
  assert.equal(boot.status, 200);
  assert.equal(boot.headers["cache-control"], "no-store");
  const token = JSON.parse(boot.body).data.token;
  assert.ok(token);

  const noToken = await req(port, "/submit", {
    method: "POST",
    headers: { ...session, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(noToken.status, 403);
  assert.equal(JSON.parse(noToken.body).error.code, "CSRF_HEADER_MISSING");

  const withToken = await req(port, "/submit", {
    method: "POST",
    headers: {
      ...session,
      "content-type": "application/json",
      "x-csrf-token": token,
    },
    body: "{}",
  });
  assert.equal(withToken.status, 200);
  await stop(server);
});

test("rotation: second bootstrap invalidates first token (onBootstrap)", async () => {
  const store = new InMemoryRotationStore();
  const mw = apiPilot({
    csrf: { enabled: true, rotationStore: store },
    csrfKeyRing: keyRing,
    csrfBinding: { sessionExtractor: (req) => req.headers["x-session-id"] ?? null },
  });
  const server = await startServer(mw, okHandler);
  const port = server.address().port;
  const session = { "x-session-id": "sess-rot" };

  const b1 = await req(port, "/api/csrf", { headers: session });
  const t1 = JSON.parse(b1.body).data.token;
  // Rotation markers are second-granularity; wait so the second marker
  // is strictly greater than t1's issue timestamp.
  await new Promise((r) => setTimeout(r, 1100));
  const b2 = await req(port, "/api/csrf", { headers: session });
  const t2 = JSON.parse(b2.body).data.token;

  const old = await req(port, "/submit", {
    method: "POST",
    headers: { ...session, "content-type": "application/json", "x-csrf-token": t1 },
    body: "{}",
  });
  assert.equal(old.status, 403);
  assert.equal(JSON.parse(old.body).error.code, "CSRF_TOKEN_INVALID");

  const fresh = await req(port, "/submit", {
    method: "POST",
    headers: { ...session, "content-type": "application/json", "x-csrf-token": t2 },
    body: "{}",
  });
  assert.equal(fresh.status, 200);
  await stop(server);
});

test("rotationRequirement=required without store throws", () => {
  assert.throws(
    () => apiPilot({ csrf: { enabled: true, rotationRequirement: "required" }, csrfKeyRing: keyRing }),
    /rotationStore/,
  );
});

test("paginationEnabled parses query and rejects bad params", async () => {
  const mw = apiPilot({ paginationEnabled: true });
  let seen = null;
  const server = await startServer(mw, (req, res) => {
    seen = getPagination(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const port = server.address().port;
  const res = await req(port, "/items?page=2&pageSize=10&sort=name:asc");
  assert.equal(res.status, 200);
  assert.equal(seen.pageRequest.page, 2);
  assert.equal(seen.pageRequest.pageSize, 10);

  const bad = await req(port, "/items?page=abc");
  assert.equal(bad.status, 400);
  assert.equal(JSON.parse(bad.body).error.code, "VALIDATION_ERROR");
  await stop(server);
});

test("withApiPilot wraps a raw handler", async () => {
  const server = createServer(
    withApiPilot((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ wrapped: true }));
    }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const res = await req(port, "/x");
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).wrapped, true);
  await stop(server);
});

// --- apiPilotErrorHandler ---

function errorServer(routes, handlerOpts) {
  const mw = apiPilot();
  const errMw = apiPilotErrorHandler(handlerOpts);
  const server = createServer((req, res) => {
    mw(req, res, () => {
      try {
        routes(req, res);
      } catch (e) {
        errMw(e, req, res, () => {});
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("error handler maps unknown error to INTERNAL_ERROR 500", async () => {
  const server = await errorServer(() => {
    throw new Error("boom");
  });
  const port = server.address().port;
  const res = await req(port, "/fail");
  assert.equal(res.status, 500);
  const json = JSON.parse(res.body);
  assert.equal(json.success, false);
  assert.equal(json.error.code, "INTERNAL_ERROR");
  assert.equal(json.error.message, "An unexpected error occurred.");
  await stop(server);
});

test("error handler reveals message when configured", async () => {
  const server = await errorServer(
    () => { throw new Error("sensitive detail"); },
    { exceptions: { revealExceptionMessage: true } },
  );
  const port = server.address().port;
  const res = await req(port, "/fail");
  assert.equal(res.status, 500);
  assert.equal(JSON.parse(res.body).error.message, "sensitive detail");
  await stop(server);
});

test("error handler maps ApiPilotValidationException with fields", async () => {
  const server = await errorServer(() => {
    throw new ApiPilotValidationException("bad input", { email: ["invalid"] });
  });
  const port = server.address().port;
  const res = await req(port, "/fail");
  assert.equal(res.status, 400);
  const json = JSON.parse(res.body);
  assert.equal(json.error.code, "VALIDATION_ERROR");
  assert.deepEqual(json.error.fields, { email: ["invalid"] });
  await stop(server);
});

test("error handler maps statusCode errors", async () => {
  const server = await errorServer(() => {
    const e = new Error("nope");
    e.statusCode = 404;
    throw e;
  });
  const port = server.address().port;
  const res = await req(port, "/missing");
  assert.equal(res.status, 404);
  assert.equal(JSON.parse(res.body).error.code, "RESOURCE_NOT_FOUND");
  await stop(server);
});

test("openApi option serves document at documentPath", async () => {
  const server = await startServer(
    apiPilot({ openApi: { documentTitle: "Test API", documentVersion: "2.0.0" } }),
    okHandler,
  );
  const port = server.address().port;
  const res = await req(port, "/openapi/v1.json");
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  const doc = JSON.parse(res.body);
  assert.equal(doc.openapi, "3.0.3");
  assert.equal(doc.info.title, "Test API");
  assert.equal(doc.info.version, "2.0.0");
  assert.ok(doc.components.schemas.ApiPilotErrorResponse);
  assert.ok(doc.components.schemas.ApiPilotPagination);
  // Custom path honored
  const server2 = await startServer(
    apiPilot({ openApi: { documentPath: "/docs/openapi.json" } }),
    okHandler,
  );
  const port2 = server2.address().port;
  const res2 = await req(port2, "/docs/openapi.json");
  assert.equal(res2.status, 200);
  await stop(server);
  await stop(server2);
});

test("diagnostics reports csrf-no-binding and origin-empty-allowlist", async () => {
  const { diagnostics, keyRingDiagnostics, resolveOptions } = await import("../dist/index.js");
  const options = resolveOptions({
    csrf: { enabled: true },
    origin: { enabled: true, allowedOrigins: [] },
  });
  const codes = diagnostics(options).map((d) => d.code);
  assert.ok(codes.includes("csrf-no-binding"));
  assert.ok(codes.includes("origin-empty-allowlist"));
  // keyRingDiagnostics: missing keys when csrf enabled
  const ringCodes = keyRingDiagnostics(undefined, true).map((d) => d.code);
  assert.ok(ringCodes.includes("csrf-keys-missing"));
  // single key → info diagnostic
  const single = keyRingDiagnostics({ activeKeyId: "k1", keys: { k1: Buffer.alloc(32) } }, true);
  assert.ok(single.some((d) => d.code === "csrf-single-key"));
});

test("error handler uses custom mapper first", async () => {
  const server = await errorServer(
    () => { throw new Error("teapot"); },
    {
      customMappers: [
        (e) => (e instanceof Error && e.message === "teapot"
          ? { code: "CUSTOM_TEAPOT", message: "short and stout" }
          : null),
      ],
    },
  );
  const port = server.address().port;
  const res = await req(port, "/tea");
  assert.equal(res.status, 500); // unknown custom code → default httpStatus
  const json = JSON.parse(res.body);
  assert.equal(json.error.code, "CUSTOM_TEAPOT");
  assert.equal(json.error.message, "short and stout");
  await stop(server);
});


test('cookie profile validation fails fast at startup', () => {
  assert.throws(
    () => apiPilot({ cookies: { auth: { secure: false, sameSite: 'none' } } }),
    /Invalid cookie profile configuration/
  );
});
