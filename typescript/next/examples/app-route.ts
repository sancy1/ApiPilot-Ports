// Example App Router route — drop into app/api/items/route.ts
// Requires: npm install @apipilot/next @apipilot/node
import { withApiPilot, apiSuccess, apiPaginatedResponse, getPagination } from "@apipilot/next";
import { generateKeyMaterial } from "@apipilot/node";

const keyRing = {
  activeKeyId: "k1",
  keys: { k1: Buffer.from(generateKeyMaterial(), "base64") },
};

const options = {
  csrfKeyRing: keyRing,
  csrf: { enabled: true },
  csrfBinding: {
    sessionExtractor: (req: Request) => req.headers.get("x-session-id"),
  },
  paginationEnabled: true,
};

const items = Array.from({ length: 95 }, (_, i) => ({ id: i + 1, name: `item-${i + 1}` }));

export const GET = withApiPilot(async (req) => {
  const p = getPagination(req);
  const page = p?.pageRequest.page ?? 1;
  const pageSize = p?.pageRequest.pageSize ?? 20;
  const slice = items.slice((page - 1) * pageSize, page * pageSize);
  return apiPaginatedResponse(slice, items.length, page, pageSize, req);
}, options);

export const POST = withApiPilot(async (req) => {
  const body = await req.json().catch(() => ({}));
  return apiSuccess({ created: body }, req, { status: 201 });
}, options);
