// Example Pages Router route — drop into pages/api/items.ts
// Requires: npm install @apipilot/next @apipilot/node
import { withApiPilotPages } from "@apipilot/next";
import { sendPaginated, sendSuccess, buildPagination, getPagination } from "@apipilot/node";
import { generateKeyMaterial } from "@apipilot/node";

const keyRing = {
  activeKeyId: "k1",
  keys: { k1: Buffer.from(generateKeyMaterial(), "base64") },
};

const options = {
  csrfKeyRing: keyRing,
  csrf: { enabled: true },
  csrfBinding: {
    sessionExtractor: (req: { headers: Record<string, unknown> }) =>
      (req.headers["x-session-id"] as string) ?? "",
  },
  paginationEnabled: true,
};

const items = Array.from({ length: 95 }, (_, i) => ({ id: i + 1, name: `item-${i + 1}` }));

export default withApiPilotPages(async (req, res) => {
  if (req.method === "GET") {
    const p = getPagination(req);
    const page = p?.pageRequest.page ?? 1;
    const pageSize = p?.pageRequest.pageSize ?? 20;
    const slice = items.slice((page - 1) * pageSize, page * pageSize);
    sendPaginated(req, res, slice, buildPagination(items.length, page, pageSize));
    return;
  }
  if (req.method === "POST") {
    sendSuccess(req, res, { created: true }, { status: 201 });
    return;
  }
  res.statusCode = 405;
  res.end();
}, options);
