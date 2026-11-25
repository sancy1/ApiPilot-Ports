// ApiPilot + raw node:http example — no framework at all.
// Run: npm install && npm run raw
// Then: curl http://localhost:3001/health
import { createServer } from "node:http";
import {
  apiPilot,
  apiPilotErrorHandler,
  generateKeyMaterial,
  sendSuccess,
} from "@apipilot/node";

const keyRing = {
  activeKeyId: "dev",
  keys: { dev: Buffer.from(generateKeyMaterial(), "base64") },
};

const pipeline = apiPilot({
  csrfKeyRing: keyRing,
  csrf: { enabled: true },
  csrfBinding: {
    sessionExtractor: (req) => req.headers["x-session-id"] ?? "",
  },
});
const onError = apiPilotErrorHandler();

function handler(req, res) {
  if (req.method === "GET" && req.url === "/health") {
    sendSuccess(req, res, { status: "ok" });
    return;
  }
  // Throw to demonstrate envelope error mapping.
  const err = new Error("not found");
  err.statusCode = 404;
  throw err;
}

const server = createServer((req, res) => {
  pipeline(req, res, () => {
    try {
      handler(req, res);
    } catch (err) {
      onError(err, req, res, () => res.end());
    }
  });
});

server.listen(3001, () => console.log("ApiPilot raw node:http example on http://localhost:3001"));
