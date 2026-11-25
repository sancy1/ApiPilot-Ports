// ApiPilot + Koa example.
// Run: npm install && npm run koa
// Then: curl http://localhost:3002/health
//       curl http://localhost:3002/api/csrf -H "X-Session-Id: demo"
import Koa from "koa";
import {
  apiPilotKoa,
  apiPilotKoaErrorHandler,
  buildPagination,
  generateKeyMaterial,
  getPagination,
  sendPaginated,
  sendSuccess,
} from "@apipilot/node";

const app = new Koa();

const keyRing = {
  activeKeyId: "dev",
  keys: { dev: Buffer.from(generateKeyMaterial(), "base64") },
};

// 1. ApiPilot pipeline as Koa middleware — ctx.req/ctx.res are the raw
//    node req/res, so the whole Connect-style pipeline runs unchanged.
app.use(apiPilotKoa({
  csrfKeyRing: keyRing,
  csrf: { enabled: true },
  csrfBinding: {
    sessionExtractor: (req) => req.headers["x-session-id"] ?? "",
  },
  paginationEnabled: true,
}));

// 2. Routes — Koa style. ctx.req is the raw IncomingMessage, so the
//    ApiPilot response helpers work directly.
const items = Array.from({ length: 95 }, (_, i) => ({ id: i + 1, name: `item-${i + 1}` }));

app.use(async (ctx) => {
  const { req, res } = ctx;
  if (req.method === "GET" && req.url === "/health") {
    sendSuccess(req, res, { status: "ok" });
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/items")) {
    const pctx = getPagination(req);
    const page = pctx?.pageRequest.page ?? 1;
    const pageSize = pctx?.pageRequest.pageSize ?? 20;
    const slice = items.slice((page - 1) * pageSize, page * pageSize);
    sendPaginated(req, res, slice, buildPagination(items.length, page, pageSize));
    return;
  }
  if (req.method === "POST" && req.url === "/items") {
    // Unsafe method — requires X-CSRF-Token from GET /api/csrf.
    sendSuccess(req, res, { created: true }, { status: 201 });
    return;
  }
  const err = new Error("not found");
  err.statusCode = 404;
  throw err;
});

// 3. Error handler LAST — Koa middleware catching downstream throws.
app.use(apiPilotKoaErrorHandler());

app.listen(3002, () => console.log("ApiPilot Koa example on http://localhost:3002"));
