// filepath: test/core.test.mjs
// layer: test | package: @apipilot/core | since: v0.1.0
// purpose: Core module unit tests — edge cases beyond the conformance vectors.
// Mirrors go/core/*_test.go and python/tests/test_core.py.
// -----------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ApiErrorCode,
  createMeta,
  success,
  paginated,
  failure,
  validationFailure,
  buildPagination,
  defaultIntegerParser,
  createPageRequest,
  computePagination,
  wirePageToInternal,
  parseSortDirection,
  parsePaginationQuery,
  DEFAULT_PAGINATION_OPTIONS,
  normalizeFieldKey,
  resolveKeyTransform,
  tryParseOrigin,
  originMatches,
  evaluateFetchMetadata,
  DEFAULT_FETCH_METADATA_OPTIONS,
  validateCookieProfile,
  DEFAULT_COOKIE_PROFILES,
  encodeCsrfPayload,
  tryDecodeCsrfPayload,
  csrfBindingFingerprint,
  resolveCorrelationId,
  DEFAULT_CORRELATION_OPTIONS,
  generateGuidV7,
  extractMediaType,
  isAcceptHeaderAcceptable,
  isContentTypeAcceptable,
  evaluateContentNegotiation,
  DEFAULT_CONTENT_NEGOTIATION_OPTIONS,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Envelope wire shape
// ---------------------------------------------------------------------------

test("success envelope JSON shape", () => {
  const meta = createMeta("req-1");
  const env = success({ n: 1 }, meta);
  const body = JSON.stringify(env);
  assert.ok(body.startsWith('{"success":true,"data":{"n":1},"message":null,"meta":{'));
  assert.equal(env.meta.requestId, "req-1");
  assert.deepEqual(env.meta.extra, {});
  assert.ok(env.meta.timestamp);
});

test("paginated envelope has all six fields", () => {
  const meta = createMeta("r");
  const pag = buildPagination(95, 2, 20);
  const env = paginated([1], pag, meta);
  for (const k of ["page", "pageSize", "totalItems", "totalPages", "hasNext", "hasPrevious"]) {
    assert.ok(k in env.pagination, k);
  }
  assert.equal(env.pagination.totalPages, 5);
  assert.equal(env.pagination.hasNext, true);
  assert.equal(env.pagination.hasPrevious, true);
});

test("error envelope omits fields when undefined", () => {
  const meta = createMeta("r");
  const env = failure(ApiErrorCode.ResourceNotFound, "nope", meta);
  assert.equal(env.error.fields, undefined);
  assert.equal(env.success, false);
});

test("validation failure default message matches C#", () => {
  const meta = createMeta("r");
  const env = validationFailure({ name: ["required"] }, meta, "");
  assert.equal(env.error.message, "One or more values are invalid.");
  assert.equal(env.error.code, "VALIDATION_ERROR");
});

test("validation failure whitespace message falls back", () => {
  const meta = createMeta("r");
  const env = validationFailure({ name: ["required"] }, meta, "   ");
  assert.equal(env.error.message, "One or more values are invalid.");
});

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

test("ApiErrorCode.from normalization", () => {
  const c = ApiErrorCode.from("  validation_error  ");
  assert.equal(c.value, "VALIDATION_ERROR");
  assert.equal(c.httpStatus, 400);
});

test("ApiErrorCode.from custom gets 500", () => {
  const c = ApiErrorCode.from("MyCustomCode");
  assert.equal(c.value, "MYCUSTOMCODE");
  assert.equal(c.httpStatus, 500);
});

test("ApiErrorCode.from empty throws", () => {
  assert.throws(() => ApiErrorCode.from("   "));
  assert.throws(() => ApiErrorCode.from(null));
});

test("ApiErrorCode.all has 14 codes", () => {
  assert.equal(ApiErrorCode.all.length, 14);
});

// ---------------------------------------------------------------------------
// Field keys
// ---------------------------------------------------------------------------

test("normalizeFieldKey JSONPath prefix", () => {
  assert.equal(normalizeFieldKey("$.User.Name"), "user.name");
});

test("normalizeFieldKey brackets preserved", () => {
  assert.equal(normalizeFieldKey("Items[0].Name"), "items[0].name");
});

test("normalizeFieldKey empty", () => {
  assert.equal(normalizeFieldKey(""), "");
});

test("resolveKeyTransform custom wins", () => {
  const custom = (raw) => "X:" + raw;
  assert.equal(resolveKeyTransform(custom)("a"), "X:a");
  assert.equal(resolveKeyTransform(null)("A"), "a");
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

test("defaultIntegerParser", () => {
  const cases = [
    ["42", 42, true], ["+7", 7, true], ["-3", -3, true], ["  10  ", 10, true],
    ["", null, false], ["abc", null, false], ["1.5", null, false],
    ["0x10", null, false], ["1e3", null, false], ["--5", null, false],
  ];
  for (const [raw, want, ok] of cases) {
    const got = defaultIntegerParser(raw);
    assert.equal(got !== null, ok, `raw=${raw}`);
    if (ok) assert.equal(got, want, `raw=${raw}`);
  }
});

test("createPageRequest validation", () => {
  const opts = DEFAULT_PAGINATION_OPTIONS;
  assert.throws(() => createPageRequest(0, 10, opts));
  assert.throws(() => createPageRequest(1, 0, opts));
  assert.throws(() => createPageRequest(1, 101, opts));
  const pr = createPageRequest(3, 50, opts);
  assert.equal(pr.page, 3);
  assert.equal(pr.pageSize, 50);
});

test("computePagination edge cases", () => {
  let r = computePagination(0, 1, 20);
  assert.equal(r.totalPages, 1);
  assert.equal(r.hasNext, false);
  assert.equal(r.hasPrevious, false);
  r = computePagination(40, 2, 20);
  assert.equal(r.totalPages, 2);
  assert.equal(r.hasNext, false);
  assert.equal(r.hasPrevious, true);
  r = computePagination(41, 3, 20);
  assert.equal(r.totalPages, 3);
  assert.equal(r.hasNext, false);
  assert.equal(r.hasPrevious, true);
});

test("wirePageToInternal", () => {
  assert.equal(wirePageToInternal(1, 1), 1);
  assert.equal(wirePageToInternal(0, 0), 1);
  assert.equal(wirePageToInternal(5, 1), 5);
});

test("parseSortDirection", () => {
  for (const [raw, want] of [["asc", "asc"], ["ASC", "asc"], [" desc ", "desc"], ["Desc", "desc"]]) {
    assert.equal(parseSortDirection(raw), want, raw);
  }
  for (const bad of ["", "ascending", "down", "1"]) {
    assert.equal(parseSortDirection(bad), null, bad);
  }
});

test("parsePaginationQuery defaults", () => {
  const parsed = parsePaginationQuery({}, DEFAULT_PAGINATION_OPTIONS);
  assert.deepEqual(parsed.errors, {});
  assert.equal(parsed.pageRequest.page, 1);
  assert.equal(parsed.pageRequest.pageSize, 20);
  assert.equal(parsed.sort, null);
  assert.equal(parsed.filter, null);
});

test("parsePaginationQuery invalid page", () => {
  const parsed = parsePaginationQuery({ page: "abc" }, DEFAULT_PAGINATION_OPTIONS);
  assert.ok("page" in parsed.errors);
});

test("parsePaginationQuery page below base", () => {
  const parsed = parsePaginationQuery({ page: "0" }, DEFAULT_PAGINATION_OPTIONS);
  assert.ok("page" in parsed.errors);
});

test("parsePaginationQuery pageSize too big", () => {
  const parsed = parsePaginationQuery({ pageSize: "500" }, DEFAULT_PAGINATION_OPTIONS);
  assert.ok("pageSize" in parsed.errors);
});

test("parsePaginationQuery direction without sort", () => {
  const parsed = parsePaginationQuery({ direction: "desc" }, DEFAULT_PAGINATION_OPTIONS);
  assert.ok("sort" in parsed.errors);
});

test("parsePaginationQuery bad direction", () => {
  const parsed = parsePaginationQuery({ sort: "name", direction: "sideways" }, DEFAULT_PAGINATION_OPTIONS);
  assert.ok("direction" in parsed.errors);
});

test("parsePaginationQuery sort defaults asc", () => {
  const parsed = parsePaginationQuery({ sort: "Name" }, DEFAULT_PAGINATION_OPTIONS);
  assert.equal(parsed.sort.field, "Name");
  assert.equal(parsed.sort.direction, "asc");
});

test("parsePaginationQuery filters", () => {
  const parsed = parsePaginationQuery({ status: "active", page: "2" }, DEFAULT_PAGINATION_OPTIONS);
  assert.equal(parsed.filter.parameters.status, "active");
  assert.ok(!("page" in parsed.filter.parameters));
});

test("parsePaginationQuery strict validation", () => {
  const opts = { ...DEFAULT_PAGINATION_OPTIONS, strictQueryValidation: true };
  const parsed = parsePaginationQuery({ unknown: "x" }, opts);
  assert.ok("unknown" in parsed.errors);
});

test("parsePaginationQuery custom names", () => {
  const opts = {
    ...DEFAULT_PAGINATION_OPTIONS,
    parameterNames: { page: "p", pageSize: "ps", sort: "s", direction: "d" },
  };
  const parsed = parsePaginationQuery({ p: "3", ps: "10", s: "name", d: "desc" }, opts);
  assert.deepEqual(parsed.errors, {});
  assert.equal(parsed.pageRequest.page, 3);
  assert.equal(parsed.pageRequest.pageSize, 10);
  assert.equal(parsed.sort.direction, "desc");
});

test("parsePaginationQuery custom page number base", () => {
  const opts = { ...DEFAULT_PAGINATION_OPTIONS, pageNumberBase: 0 };
  const parsed = parsePaginationQuery({ page: "0" }, opts);
  assert.deepEqual(parsed.errors, {});
  assert.equal(parsed.pageRequest.page, 1);
});

test("parsePaginationQuery empty values ignored", () => {
  const parsed = parsePaginationQuery({ page: "", pageSize: "", sort: "" }, DEFAULT_PAGINATION_OPTIONS);
  assert.deepEqual(parsed.errors, {});
});

// ---------------------------------------------------------------------------
// Origin
// ---------------------------------------------------------------------------

test("tryParseOrigin valid", () => {
  const p = tryParseOrigin("https://Example.COM:8443");
  assert.equal(p.scheme, "https");
  assert.equal(p.host, "example.com");
  assert.equal(p.port, 8443);
});

test("tryParseOrigin default ports", () => {
  assert.equal(tryParseOrigin("https://example.com").port, 443);
  assert.equal(tryParseOrigin("http://example.com").port, 80);
});

test("tryParseOrigin rejects", () => {
  for (const bad of [
    "", "null", "not a url", "https://example.com/path",
    "https://example.com?q=1", "https://example.com#frag",
    "ftp://", "https://:8080", "https://example.com:abc",
  ]) {
    assert.equal(tryParseOrigin(bad), null, bad);
  }
});

test("originMatches exact", () => {
  assert.equal(originMatches("https://a.com", "https://a.com", "exact"), true);
  assert.equal(originMatches("https://a.com:8443", "https://a.com", "exact"), false);
  assert.equal(originMatches("https://a.com:8443", "https://a.com:8443", "exact"), true);
});

test("originMatches anyPortSameHost", () => {
  assert.equal(originMatches("https://a.com:8443", "https://a.com", "anyPortSameHost"), true);
  assert.equal(originMatches("https://a.com", "https://b.com", "anyPortSameHost"), false);
  assert.equal(originMatches("http://a.com", "https://a.com", "anyPortSameHost"), false);
});

test("originMatches sameSite always false", () => {
  assert.equal(originMatches("https://a.com", "https://a.com", "sameSite"), false);
});

test("originMatches invalid input", () => {
  assert.equal(originMatches("garbage", "https://a.com", "exact"), false);
});

// ---------------------------------------------------------------------------
// Fetch metadata
// ---------------------------------------------------------------------------

test("fetch metadata off always allows", () => {
  const d = evaluateFetchMetadata("cross-site", "no-cors", DEFAULT_FETCH_METADATA_OPTIONS);
  assert.equal(d.decision, "allow");
});

test("fetch metadata missing headers allowed", () => {
  const opts = { ...DEFAULT_FETCH_METADATA_OPTIONS, profile: "strict" };
  const d = evaluateFetchMetadata(null, null, opts);
  assert.equal(d.decision, "allow");
});

test("fetch metadata missing headers rejected", () => {
  const opts = { ...DEFAULT_FETCH_METADATA_OPTIONS, profile: "strict", allowMissingHeaders: false };
  const d = evaluateFetchMetadata(null, null, opts);
  assert.equal(d.decision, "reject");
  assert.equal(d.reason, "missingSiteHeader");
});

test("fetch metadata malformed site", () => {
  const opts = { ...DEFAULT_FETCH_METADATA_OPTIONS, profile: "compat", allowMissingHeaders: false };
  const d = evaluateFetchMetadata("bogus", null, opts);
  assert.equal(d.decision, "reject");
  assert.equal(d.reason, "malformedSiteHeader");
});

test("fetch metadata disallowed site", () => {
  const opts = { ...DEFAULT_FETCH_METADATA_OPTIONS, profile: "strict" };
  const d = evaluateFetchMetadata("cross-site", null, opts);
  assert.equal(d.decision, "reject");
  assert.equal(d.reason, "disallowedSiteValue");
});

test("fetch metadata disallowed mode", () => {
  const opts = { ...DEFAULT_FETCH_METADATA_OPTIONS, profile: "strict" };
  const d = evaluateFetchMetadata("same-origin", "no-cors", opts);
  assert.equal(d.decision, "reject");
  assert.equal(d.reason, "disallowedModeValue");
});

test("fetch metadata compat equals strict", () => {
  const strict = { ...DEFAULT_FETCH_METADATA_OPTIONS, profile: "strict" };
  const compat = { ...DEFAULT_FETCH_METADATA_OPTIONS, profile: "compat" };
  const d1 = evaluateFetchMetadata("cross-site", "cors", strict);
  const d2 = evaluateFetchMetadata("cross-site", "cors", compat);
  assert.deepEqual(d1, d2);
});

test("fetch metadata case insensitive", () => {
  const opts = { ...DEFAULT_FETCH_METADATA_OPTIONS, profile: "strict" };
  const d = evaluateFetchMetadata("SAME-ORIGIN", "CORS", opts);
  assert.equal(d.decision, "allow");
});

// ---------------------------------------------------------------------------
// Cookie profiles
// ---------------------------------------------------------------------------

test("default cookie profiles are valid", () => {
  for (const [role, profile] of Object.entries(DEFAULT_COOKIE_PROFILES)) {
    assert.deepEqual(validateCookieProfile(profile, role), [], role);
  }
});

test("cookie profile host prefix rules", () => {
  const p = {
    name: "x", secure: false, httpOnly: true, sameSite: "lax",
    path: "/", domain: null, namePrefix: "__Host-",
  };
  const v = validateCookieProfile(p, "auth");
  assert.ok(v.includes("host-prefix-requires-secure"));
  assert.ok(!v.includes("host-prefix-requires-root-path"));
});

test("cookie profile host prefix domain", () => {
  const p = {
    name: "x", secure: true, httpOnly: true, sameSite: "lax",
    path: "/", domain: "example.com", namePrefix: "__Host-",
  };
  const v = validateCookieProfile(p, "auth");
  assert.ok(v.includes("host-prefix-requires-no-domain"));
});

test("cookie profile samesite none requires secure", () => {
  const p = {
    name: "x", secure: false, httpOnly: true, sameSite: "none",
    path: "/", domain: null,
  };
  const v = validateCookieProfile(p, "auth");
  assert.ok(v.includes("samesite-none-requires-secure"));
});

test("cookie profile unspecified samesite", () => {
  const p = {
    name: "x", secure: true, httpOnly: true, sameSite: "unspecified",
    path: "/", domain: null,
  };
  const v = validateCookieProfile(p, "auth");
  assert.ok(v.includes("undefined-samesite"));
});

test("cookie profile bad path", () => {
  const p = {
    name: "x", secure: true, httpOnly: true, sameSite: "lax",
    path: "relative", domain: null,
  };
  const v = validateCookieProfile(p, "auth");
  assert.ok(v.includes("path-must-start-slash"));
});

test("cookie profile forbidden name char", () => {
  const p = {
    name: "bad;name", secure: true, httpOnly: true, sameSite: "lax",
    path: "/", domain: null,
  };
  const v = validateCookieProfile(p, "auth");
  assert.ok(v.includes("forbidden-name-char"));
});

test("cookie profile invalid domain", () => {
  const p = {
    name: "x", secure: true, httpOnly: true, sameSite: "lax",
    path: "/", domain: "bad domain.com",
  };
  const v = validateCookieProfile(p, "auth");
  assert.ok(v.includes("invalid-domain"));
});

// ---------------------------------------------------------------------------
// CSRF payload codec
// ---------------------------------------------------------------------------

test("csrf payload round trip", () => {
  const payload = encodeCsrfPayload(1700000000, "abc123", "fp");
  const parts = tryDecodeCsrfPayload(payload);
  assert.equal(parts.issuedAtUnixSeconds, 1700000000);
  assert.equal(parts.randomBase64Url, "abc123");
  assert.equal(parts.bindingFingerprint, "fp");
});

test("csrf payload encode rejects delimiter", () => {
  assert.throws(() => encodeCsrfPayload(1, "a|b", "fp"));
  assert.throws(() => encodeCsrfPayload(1, "abc", "f|p"));
  assert.throws(() => encodeCsrfPayload(1, "", "fp"));
  assert.throws(() => encodeCsrfPayload(1, "abc", ""));
});

test("csrf payload decode rejects", () => {
  for (const bad of [
    "", "a|b", "a|b|c|d", "x|y|z", "1.5|r|f",
    "|r|f", "1||f", "1|r|", "99999999999999999999|r|f",
  ]) {
    assert.equal(tryDecodeCsrfPayload(bad), null, bad);
  }
});

test("csrf payload time bounds", () => {
  const p = encodeCsrfPayload(-62135596800, "r", "f");
  assert.notEqual(tryDecodeCsrfPayload(p), null);
  assert.equal(tryDecodeCsrfPayload("-62135596801|r|f"), null);
  assert.equal(tryDecodeCsrfPayload("253402300800|r|f"), null);
});

// ---------------------------------------------------------------------------
// CSRF binding fingerprint
// ---------------------------------------------------------------------------

test("csrf binding fingerprint deterministic", () => {
  const f1 = csrfBindingFingerprint("user-1", "subject");
  const f2 = csrfBindingFingerprint("user-1", "subject");
  assert.equal(f1, f2);
  assert.equal(f1.length, 43);
});

test("csrf binding fingerprint kind separation", () => {
  const subject = csrfBindingFingerprint("x", "subject");
  const session = csrfBindingFingerprint("x", "session");
  const preauth = csrfBindingFingerprint("x", "preauth");
  assert.notEqual(subject, session);
  assert.notEqual(subject, preauth);
  assert.notEqual(session, preauth);
});

test("csrf binding fingerprint source separation", () => {
  const a = csrfBindingFingerprint("user-a", "subject");
  const b = csrfBindingFingerprint("user-b", "subject");
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

test("resolveCorrelationId absent generates", () => {
  const d = resolveCorrelationId(null, DEFAULT_CORRELATION_OPTIONS, false);
  assert.equal(d.kind, "generate");
});

test("resolveCorrelationId valid incoming", () => {
  const d = resolveCorrelationId("req-abc-12345", DEFAULT_CORRELATION_OPTIONS, true);
  assert.equal(d.kind, "use-incoming");
  assert.equal(d.id, "req-abc-12345");
});

test("resolveCorrelationId invalid replace", () => {
  const d = resolveCorrelationId("bad id with spaces!", DEFAULT_CORRELATION_OPTIONS, false);
  assert.equal(d.kind, "generate");
});

test("resolveCorrelationId invalid reject", () => {
  const opts = { ...DEFAULT_CORRELATION_OPTIONS, invalidIdPolicy: "reject" };
  const d = resolveCorrelationId("bad id!", opts, false);
  assert.equal(d.kind, "reject");
});

test("resolveCorrelationId invalid useAsIs", () => {
  const opts = { ...DEFAULT_CORRELATION_OPTIONS, invalidIdPolicy: "useAsIs" };
  const d = resolveCorrelationId("bad id!", opts, false);
  assert.equal(d.kind, "use-incoming");
  assert.equal(d.id, "bad id!");
  assert.equal(d.warn, true);
});

test("generateGuidV7 format", () => {
  const id = generateGuidV7();
  const parts = id.split("-");
  assert.equal(parts.length, 5);
  assert.equal(parts[0].length, 8);
  assert.equal(parts[1].length, 4);
  assert.equal(parts[2].length, 4);
  assert.equal(parts[3].length, 4);
  assert.equal(parts[4].length, 12);
  assert.equal(parts[2][0], "7");
  assert.ok("89ab".includes(parts[3][0]));
  assert.match(id, /^[0-9a-f-]+$/);
});

test("generateGuidV7 unique", () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(generateGuidV7());
  assert.equal(ids.size, 1000);
});

test("generateGuidV7 time ordered", () => {
  const a = generateGuidV7();
  const b = generateGuidV7();
  assert.ok(a.slice(0, 12) <= b.slice(0, 12));
});

// ---------------------------------------------------------------------------
// Content negotiation
// ---------------------------------------------------------------------------

test("extractMediaType", () => {
  assert.equal(extractMediaType("application/json; charset=utf-8"), "application/json");
  assert.equal(extractMediaType("  text/html  "), "text/html");
  assert.equal(extractMediaType("application/json"), "application/json");
});

test("accept header q values ignored", () => {
  assert.equal(
    isAcceptHeaderAcceptable("text/html;q=0.9, application/json;q=0.8", DEFAULT_CONTENT_NEGOTIATION_OPTIONS),
    true,
  );
});

test("accept header type wildcard not honored", () => {
  assert.equal(isAcceptHeaderAcceptable("application/*", DEFAULT_CONTENT_NEGOTIATION_OPTIONS), false);
});

test("accept header missing accepts", () => {
  assert.equal(isAcceptHeaderAcceptable(null, DEFAULT_CONTENT_NEGOTIATION_OPTIONS), true);
  assert.equal(isAcceptHeaderAcceptable("", DEFAULT_CONTENT_NEGOTIATION_OPTIONS), true);
});

test("accept header rejects all", () => {
  assert.equal(isAcceptHeaderAcceptable("text/html, application/xml", DEFAULT_CONTENT_NEGOTIATION_OPTIONS), false);
});

test("accept wildcard disabled", () => {
  const opts = { ...DEFAULT_CONTENT_NEGOTIATION_OPTIONS, acceptWildcard: false };
  assert.equal(isAcceptHeaderAcceptable("*/*", opts), false);
});

test("content type case insensitive", () => {
  assert.equal(isContentTypeAcceptable("Application/JSON; charset=utf-8", DEFAULT_CONTENT_NEGOTIATION_OPTIONS), true);
});

test("evaluate negotiation GET skips content type", () => {
  const d = evaluateContentNegotiation(null, null, "GET", DEFAULT_CONTENT_NEGOTIATION_OPTIONS);
  assert.equal(d.status, 200);
});

test("evaluate negotiation POST missing content type", () => {
  const d = evaluateContentNegotiation(null, null, "POST", DEFAULT_CONTENT_NEGOTIATION_OPTIONS);
  assert.equal(d.status, 415);
});

test("evaluate negotiation POST missing allowed", () => {
  const opts = { ...DEFAULT_CONTENT_NEGOTIATION_OPTIONS, acceptMissingContentType: true };
  const d = evaluateContentNegotiation(null, null, "POST", opts);
  assert.equal(d.status, 200);
});

test("evaluate negotiation accept rejects first", () => {
  const d = evaluateContentNegotiation("text/html", "text/plain", "POST", DEFAULT_CONTENT_NEGOTIATION_OPTIONS);
  assert.equal(d.status, 406);
});

test("evaluate negotiation DELETE not body carrying", () => {
  const d = evaluateContentNegotiation(null, null, "DELETE", DEFAULT_CONTENT_NEGOTIATION_OPTIONS);
  assert.equal(d.status, 200);
});
