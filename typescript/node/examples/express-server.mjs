// ApiPilot + Express example.
// Run: npm install && npm run express
// Then: curl http://localhost:3000/health
//       curl http://localhost:3000/api/csrf   (CSRF bootstrap)
import express from "express";
import {
  apiPilot,
  apiPilotErrorHandler,
  buildPagination,
  generateKeyMaterial,
  getPagination,
  sendPaginated,
  sendSuccess,
} from "@apipilot/node";

const app = express();

// Ephemeral dev key ring — use keyRingFromEnv() / APIPILOT_CSRF_KEYS in prod.
const keyRing = {
  activeKeyId: "dev",
  keys: { dev: Buffer.from(generateKeyMaterial(), "base64") },
};

// 1. ApiPilot pipeline FIRST — correlation, rate limit, origin,
//    fetch-metadata, cookies, CSRF, pagination all run here.
app.use(apiPilot({
  csrfKeyRing: keyRing,
  csrf: { enabled: true },
  csrfBinding: {
    // Bind tokens to a header standing in for "session" in this example.
    sessionExtractor: (req) => req.headers["x-session-id"] ?? "",
  },
  paginationEnabled: true,
  origin: { enabled: true, allowedOrigins: ["http://localhost:3000"] },
}));

app.use(express.json());

// 2. Routes — envelopes via sendSuccess / sendPaginated.
app.get("/health", (req, res) => {
  sendSuccess(req, res, { status: "ok" });
});

const items = Array.from({ length: 95 }, (_, i) => ({ id: i + 1, name: `item-${i + 1}` }));

app.get("/items", (req, res) => {
  const ctx = getPagination(req);
  const page = ctx?.pageRequest.page ?? 1;
  const pageSize = ctx?.pageRequest.pageSize ?? 20;
  const slice = items.slice((page - 1) * pageSize, page * pageSize);
  const pagination = buildPagination(items.length, page, pageSize);
  sendPaginated(req, res, slice, pagination, { status: 200 });
});

app.post("/items", (req, res) => {
  // Unsafe method — requires X-CSRF-Token from GET /api/csrf.
  sendSuccess(req, res, { created: true, body: req.body }, { status: 201 });
});

// 3. Error handler LAST — maps thrown errors to ApiPilot envelopes.
app.use(apiPilotErrorHandler());

app.listen(3000, () => console.log("ApiPilot Express example on http://localhost:3000"));
