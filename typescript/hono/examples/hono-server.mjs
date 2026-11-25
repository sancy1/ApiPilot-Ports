// ApiPilot + Hono example.
// Run: npm install && node examples/hono-server.mjs
// Then: curl http://localhost:3003/health
//       curl http://localhost:3003/api/csrf -H "X-Session-Id: demo"
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  apiPilotHono,
  apiPilotHonoErrorHandler,
  getPagination,
  paginatedResponse,
  sendSuccess,
} from "../dist/index.js";
import { generateKeyMaterial } from "@apipilot/node";

const app = new Hono();

const keyRing = {
  activeKeyId: "dev",
  keys: { dev: Buffer.from(generateKeyMaterial(), "base64") },
};

// 1. ApiPilot pipeline as Hono middleware.
app.use(apiPilotHono({
  csrfKeyRing: keyRing,
  csrf: { enabled: true },
  csrfBinding: {
    sessionExtractor: (c) => c.req.header("x-session-id") ?? null,
  },
  paginationEnabled: true,
}));

// 2. Routes — Hono style. sendSuccess/sendPaginated produce envelopes.
const items = Array.from({ length: 95 }, (_, i) => ({ id: i + 1, name: `item-${i + 1}` }));

app.get("/health", (c) => sendSuccess(c, { status: "ok" }));

app.get("/items", (c) => {
  const p = getPagination(c);
  const page = p?.pageRequest.page ?? 1;
  const pageSize = p?.pageRequest.pageSize ?? 20;
  const slice = items.slice((page - 1) * pageSize, page * pageSize);
  return paginatedResponse(c, slice, items.length, page, pageSize);
});

app.post("/items", async (c) => {
  // Unsafe method — requires X-CSRF-Token from GET /api/csrf.
  const body = await c.req.json().catch(() => ({}));
  return sendSuccess(c, { created: body }, { status: 201 });
});

app.get("/boom", () => {
  const err = new Error("demo failure");
  err.statusCode = 418;
  throw err;
});

// 3. Error handler — Hono routes handler errors to onError.
app.onError(apiPilotHonoErrorHandler());

serve({ fetch: app.fetch, port: 3003 }, () => {
  console.log("ApiPilot Hono example on http://localhost:3003");
});
