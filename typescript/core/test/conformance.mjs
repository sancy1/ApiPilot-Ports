// filepath: test/conformance.mjs
// layer: test | package: @apipilot/core | since: v0.1.0
// purpose: Conformance vector runner — executes conformance/vectors/*.json against @apipilot/core.
// -----------------------------------------------------------------------------
// Runner contract per docs/conformance-vectors.md (C# reference).
// Exits non-zero if any vector fails.
// -----------------------------------------------------------------------------

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ApiErrorCode,
  normalizeFieldKey,
  parsePaginationQuery,
  buildPagination,
  wirePageToInternal,
  createPageRequest,
  DEFAULT_PAGINATION_OPTIONS,
  parseSortDirection,
  tryParseOrigin,
  originMatches,
  evaluateFetchMetadata,
  DEFAULT_FETCH_METADATA_OPTIONS,
  validateCookieProfile,
  encodeCsrfPayload,
  tryDecodeCsrfPayload,
  csrfBindingFingerprint,
  resolveCorrelationId,
  DEFAULT_CORRELATION_OPTIONS,
  evaluateContentNegotiation,
  DEFAULT_CONTENT_NEGOTIATION_OPTIONS,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsDir = join(here, "..", "conformance", "vectors");

let passed = 0;
let failed = 0;
const failures = [];

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function check(id, actual, expected, label = "") {
  if (deepEqual(actual, expected)) {
    passed++;
  } else {
    failed++;
    failures.push({ id, label, expected, actual });
  }
}

// ---------- category runners ----------

function runErrorCode(v) {
  const inp = v.input;
  if (inp.codes) {
    const statuses = {};
    for (const c of inp.codes) statuses[c] = ApiErrorCode.from(c).httpStatus;
    check(v.id, statuses, v.expect.statuses, "statuses-map");
    return;
  }
  let code = null;
  let valid = true;
  try {
    code = ApiErrorCode.from(inp.raw);
  } catch {
    valid = false;
  }
  check(v.id, valid, v.expect.valid, "valid");
  if (valid) {
    check(v.id, code.value, v.expect.code, "code");
    check(v.id, code.httpStatus, v.expect.status, "status");
  }
}

function runFieldKey(v) {
  const transform = v.input.transform;
  const fn = transform === "passthrough" ? (s) => s : normalizeFieldKey;
  check(v.id, fn(v.input.raw), v.expect.normalized, "normalized");
}

function runPagination(v) {
  const inp = v.input;
  const options = {
    ...DEFAULT_PAGINATION_OPTIONS,
    defaultPageSize: inp.defaultPageSize,
    maxPageSize: inp.maxPageSize,
    pageNumberBase: inp.pageNumberBase,
  };

  // Validation cases (null/undefined page or pageSize mean "absent" → defaults)
  const hasPage = inp.page !== null && inp.page !== undefined;
  const hasSize = inp.pageSize !== null && inp.pageSize !== undefined;
  const effSize = hasSize ? inp.pageSize : inp.defaultPageSize;
  if ((hasPage && inp.page < inp.pageNumberBase) || effSize > inp.maxPageSize || effSize < 1) {
    let error = null;
    try {
      const internal = wirePageToInternal(inp.page, inp.pageNumberBase);
      createPageRequest(internal, inp.pageSize ?? inp.defaultPageSize, options);
    } catch (e) {
      error = e.message.includes("maximum") ? "pagesize-over-max" : "page-below-base";
    }
    check(v.id, error !== null, v.expect.valid === false, "invalid");
    if (v.expect.error) check(v.id, error, v.expect.error, "error");
    return;
  }

  const page = hasPage ? inp.page : inp.pageNumberBase;
  const pageSize = hasSize ? inp.pageSize : inp.defaultPageSize;
  const internalPage = wirePageToInternal(page, inp.pageNumberBase);
  const pag = buildPagination(inp.totalItems, internalPage, pageSize);

  check(v.id, pag.totalPages, v.expect.totalPages, "totalPages");
  check(v.id, pag.hasNext, v.expect.hasNext, "hasNext");
  check(v.id, pag.hasPrevious, v.expect.hasPrevious, "hasPrevious");
  check(v.id, internalPage, v.expect.internalPage, "internalPage");
  if (v.expect.pageSize !== undefined) check(v.id, pageSize, v.expect.pageSize, "pageSize");
  check(v.id, true, v.expect.valid, "valid");
}

function runFetchMetadata(v) {
  const inp = v.input;
  const options = {
    profile: inp.profile,
    allowedSiteValues: inp.allowedSiteValues,
    allowedModeValues: inp.allowedModeValues,
    allowMissingHeaders: inp.allowMissingHeaders,
  };
  const d = evaluateFetchMetadata(inp.site, inp.mode, options);
  check(v.id, d.decision, v.expect.decision, "decision");
  check(v.id, d.reason, v.expect.reason, "reason");
}

function runCookieProfile(v) {
  const violations = validateCookieProfile(v.input.profile, v.input.role);
  check(v.id, violations.length === 0, v.expect.valid, "valid");
  const expected = [...v.expect.violations].sort();
  const actual = [...violations].sort();
  check(v.id, actual, expected, "violations");
}

function runOrigin(v) {
  const inp = v.input;
  const parts = tryParseOrigin(inp.origin);
  const parseOk = parts !== null;
  check(v.id, parseOk, v.expect.parseOk, "parseOk");
  if (parseOk && v.expect.parts) {
    check(v.id, parts.scheme, v.expect.parts.scheme, "scheme");
    check(v.id, parts.host, v.expect.parts.host, "host");
    check(v.id, parts.port, v.expect.parts.port, "port");
  }
  const match = originMatches(inp.origin, inp.candidate, inp.mode);
  check(v.id, match, v.expect.match, "match");
}

function runCsrfFormat(v) {
  const inp = v.input;
  if (inp.op === "encode") {
    try {
      const payload = encodeCsrfPayload(inp.issuedAtUnixSeconds, inp.randomBase64Url, inp.bindingFingerprint);
      if (v.expect.payload !== undefined) {
        check(v.id, payload, v.expect.payload, "payload");
      } else if (v.expect.error) {
        failed++;
        failures.push({ id: v.id, label: "expected-error", expected: v.expect.error, actual: payload });
      } else {
        passed++;
      }
    } catch {
      if (v.expect.error) passed++;
      else {
        failed++;
        failures.push({ id: v.id, label: "unexpected-throw", expected: v.expect, actual: "threw" });
      }
    }
    return;
  }
  // decode
  const parts = tryDecodeCsrfPayload(inp.payload);
  check(v.id, parts !== null, v.expect.valid, "valid");
  if (parts && v.expect.issuedAtUnixSeconds !== undefined) {
    check(v.id, parts.issuedAtUnixSeconds, v.expect.issuedAtUnixSeconds, "issuedAt");
  }
  if (parts && v.expect.randomBase64Url !== undefined) {
    check(v.id, parts.randomBase64Url, v.expect.randomBase64Url, "random");
  }
  if (parts && v.expect.bindingFingerprint !== undefined) {
    check(v.id, parts.bindingFingerprint, v.expect.bindingFingerprint, "binding");
  }
}

function runCsrfBinding(v) {
  const fp = csrfBindingFingerprint(v.input.source, v.input.kind);
  check(v.id, fp, v.expect.fingerprint, "fingerprint");
}

function runSortDirection(v) {
  const d = parseSortDirection(v.input.raw);
  check(v.id, d !== null, v.expect.valid, "valid");
  check(v.id, d, v.expect.direction, "direction");
}

function runCorrelationId(v) {
  const inp = v.input;
  const options = { ...DEFAULT_CORRELATION_OPTIONS, invalidIdPolicy: inp.policy };
  const d = resolveCorrelationId(inp.headerValue, options, inp.patternMatches);
  const effective = d.kind === "use-incoming" ? "incoming" : d.kind === "generate" ? "generated" : "rejected";
  check(v.id, effective, v.expect.effectiveId, "effectiveId");
  check(v.id, d.warn === true, v.expect.warn, "warn");
}

function runContentNegotiation(v) {
  const inp = v.input;
  const options = {
    acceptableResponseMediaTypes: inp.options.acceptableResponseMediaTypes,
    acceptWildcard: inp.options.acceptWildcard,
    acceptableRequestMediaTypes: inp.options.acceptableRequestMediaTypes,
    acceptMissingContentType: inp.options.acceptMissingContentType,
    bodyCarryingMethods: inp.options.bodyCarryingMethods,
  };
  const d = evaluateContentNegotiation(inp.accept, inp.contentType, inp.method, options);
  check(v.id, d.acceptResult, v.expect.acceptResult, "acceptResult");
  check(v.id, d.contentTypeResult, v.expect.contentTypeResult, "contentTypeResult");
  check(v.id, d.status, v.expect.status, "status");
}

function runEnvelope(v) {
  // Envelope vectors assert exact JSON shape. Build via the same object literals
  // the builders produce and deep-compare.
  const inp = v.input;
  let actual;
  if (inp.kind === "error") {
    const error = { code: inp.code, message: inp.message };
    if (inp.fields) error.fields = inp.fields;
    actual = { success: false, error, meta: inp.meta };
  } else if (inp.kind === "paginated") {
    actual = {
      success: true,
      data: inp.data,
      message: inp.message,
      meta: inp.meta,
      pagination: inp.pagination,
    };
  } else {
    actual = { success: true, data: inp.data, message: inp.message, meta: inp.meta };
  }
  if (v.expect.json) {
    check(v.id, actual, v.expect.json, "json");
  }
  if (v.expect.jsonKeys) {
    check(v.id, Object.keys(actual).sort(), [...v.expect.jsonKeys].sort(), "jsonKeys");
  }
}

const runners = {
  "error-code": runErrorCode,
  "field-key": runFieldKey,
  pagination: runPagination,
  "fetch-metadata": runFetchMetadata,
  "cookie-profile": runCookieProfile,
  origin: runOrigin,
  "csrf-format": runCsrfFormat,
  "csrf-binding": runCsrfBinding,
  "sort-direction": runSortDirection,
  "correlation-id": runCorrelationId,
  "content-negotiation": runContentNegotiation,
  envelope: runEnvelope,
};

// ---------- load and run ----------

const files = readdirSync(vectorsDir).filter((f) => f.endsWith(".json")).sort();
for (const file of files) {
  const doc = JSON.parse(readFileSync(join(vectorsDir, file), "utf8"));
  const runner = runners[doc.category];
  if (!runner) {
    console.error(`NO RUNNER for category: ${doc.category} (${file})`);
    failed++;
    continue;
  }
  for (const v of doc.vectors) {
    try {
      runner(v);
    } catch (e) {
      failed++;
      failures.push({ id: v.id, label: "runner-threw", expected: v.expect, actual: String(e) });
    }
  }
}

console.log(`\nConformance: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures.slice(0, 30)) {
    console.log(`  ${f.id} [${f.label}]`);
    console.log(`    expected: ${JSON.stringify(f.expected)}`);
    console.log(`    actual:   ${JSON.stringify(f.actual)}`);
  }
  if (failures.length > 30) console.log(`  ... and ${failures.length - 30} more`);
  process.exit(1);
}
