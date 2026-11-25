// @apipilot/node — runnable example (zero framework dependencies).
// Demonstrates the full ApiPilot pipeline over raw node:http.
//
// The same middleware works unchanged with Express, Hono, NestJS (Express),
// polka, or any Connect-style framework:
//
//   import express from "express";
//   import { apiPilot } from "@apipilot/node";
//   const app = express();
//   app.use(apiPilot({ csrf: { enabled: true } }));
//   app.post("/api/items", (req, res) => res.json({ ok: true }));
//
// Run: node examples/basic.mjs

import { createServer } from "node:http";
import {
  apiPilot,
  generateKeyMaterial,
  getPagination,
  Metrics,
} from "../dist/index.js";

// --- CSRF key ring (in production: APIPILOT_CSRF_KEYS env or a KMS) ---
const key = Buffer.from(generateKeyMaterial(), "base64");
const keyRing = { activeKeyId: "k1", keys: { k1: key } };

const metrics = new Metrics();

// --- Middleware ---
const mw = apiPilot({
  csrf: {
    enabled: true,
    rotationRequirement: "optional",
  },
  csrfKeyRing: keyRing,
  csrfBinding: {
    // Bind tokens to the session cookie (or a JWT sub claim in real apps).
    sessionExtractor: (req) => {
      const cookie = req.headers.cookie ?? "";
      const m = /session=([^;]+)/.exec(cookie);
      return m ? m[1] : null;
    },
  },
  origin: {
    enabled: true,
    allowedOrigins: ["https://app.example.com"],
  },
  rateLimit: { enabled: true, requestsPerWindow: 100, windowSeconds: 60 },
  paginationEnabled: true,
  metrics,
});

// --- Routes (Connect-style: call next() to pass through) ---
function router(req, res) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/items") {
    const page = getPagination(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [], pagination: page }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/items") {
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ created: true }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}

const server = createServer((req, res) => {
  mw(req, res, () => router(req, res));
});

const port = 3100;
server.listen(port, () => {
  console.log(`ApiPilot node example listening on http://localhost:${port}`);
  console.log("Try:");
  console.log(`  curl http://localhost:${port}/api/csrf -H 'cookie: session=abc'   # bootstrap token`);
  console.log(`  curl http://localhost:${port}/api/items?page=1&pageSize=10       # paginated GET`);
  console.log(`  curl -X POST http://localhost:${port}/api/items -H 'cookie: session=abc' -H 'x-csrf-token: <token>' -H 'content-type: application/json' -d '{}'`);
});
