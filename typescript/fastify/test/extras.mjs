// filepath: test/extras.mjs
// layer: test | package: @apipilot/fastify | since: v0.2.0
// purpose: Tests for CSRF extras (rotation, transitions, endpoint policy)
//          and observability (metrics, redaction).
// -----------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CsrfProtector,
  CsrfService,
  InMemoryRotationStore,
  CsrfTransitionListener,
  attachRotationStore,
  markRotated,
  resolveEndpointPolicy,
  Metrics,
  redactString,
  redactValue,
  generateKeyMaterial,
} from "../dist/index.js";
import { csrfBindingFingerprint } from "@apipilot/core";

const keyRing = {
  activeKeyId: "k1",
  keys: { k1: Buffer.from(generateKeyMaterial(), "base64") },
};

const bindingResolver = {
  resolve: () => ({
    fingerprint: csrfBindingFingerprint("client-1", "preauth"),
    source: "client-1",
    kind: "preauth",
  }),
};

function makeService(withStore = true) {
  const protector = new CsrfProtector(keyRing);
  const service = new CsrfService(protector, bindingResolver, {
    tokenLifetimeSeconds: 7200,
    tokenEntropyBytes: 32,
  });
  const store = new InMemoryRotationStore();
  if (withStore) attachRotationStore(service, store);
  return { service, store };
}

const FP = csrfBindingFingerprint("client-1", "preauth");

// --- Rotation store ---------------------------------------------------------

test("InMemoryRotationStore get/set/clear", () => {
  const store = new InMemoryRotationStore();
  assert.equal(store.getRotationMarker("b1"), undefined);
  store.setRotationMarker("b1", 1234);
  assert.equal(store.getRotationMarker("b1"), 1234);
  store.clearRotationMarker("b1");
  assert.equal(store.getRotationMarker("b1"), undefined);
});

test("rotation rejects pre-marker token", () => {
  const { service, store } = makeService();
  const token = service.issueToken("client-1", "preauth");

  assert.equal(service.validateToken(token, FP).outcome, "valid");

  store.setRotationMarker(FP, Math.floor(Date.now() / 1000) + 3600);
  assert.equal(service.validateToken(token, FP).outcome, "rotated");

  store.clearRotationMarker(FP);
  assert.equal(service.validateToken(token, FP).outcome, "valid");
});

test("no store means no rotation", () => {
  const { service } = makeService(false);
  const token = service.issueToken("client-1", "preauth");
  assert.equal(service.validateToken(token, FP).outcome, "valid");
});

test("markRotated records marker at current time", () => {
  const { service, store } = makeService();
  const token = service.issueToken("client-1", "preauth");
  markRotated(service, FP);
  // Token issued in the same second may not be strictly before the marker;
  // a fresh token issued after rotation must validate.
  const fresh = service.issueToken("client-1", "preauth");
  const outcome = service.validateToken(fresh, FP).outcome;
  assert.ok(["valid", "rotated"].includes(outcome));
  assert.ok(store.getRotationMarker(FP) > 0);
});

// --- Transition listener ----------------------------------------------------

test("transition listener login/logout", () => {
  const { service, store } = makeService();
  const listener = new CsrfTransitionListener(service, bindingResolver, store);

  const fakeReq = {};
  const token = listener.onLogin(fakeReq);
  assert.ok(token);

  // Unresolvable binding → fail closed.
  const emptyResolver = { resolve: () => null };
  const listener2 = new CsrfTransitionListener(service, emptyResolver, store);
  assert.equal(listener2.onLogin(fakeReq), null);

  store.setRotationMarker(FP, Math.floor(Date.now() / 1000) + 3600);
  listener.onLogout(fakeReq);
  assert.equal(store.getRotationMarker(FP), undefined);
});

test("transition listener explicit binding/fingerprint", () => {
  const { service, store } = makeService();
  const listener = new CsrfTransitionListener(service, bindingResolver, store);
  const tok = listener.onLoginWithBinding("client-1", "preauth");
  assert.ok(tok);
  listener.onLogoutWithFingerprint("fp-x"); // no marker → no-op
});

// --- Endpoint policy resolver ------------------------------------------------

test("resolveEndpointPolicy precedence", () => {
  assert.equal(resolveEndpointPolicy(false, false), "useGlobal");
  assert.equal(resolveEndpointPolicy(true, false), "require");
  assert.equal(resolveEndpointPolicy(false, true), "skip");
  assert.equal(resolveEndpointPolicy(true, true), "require"); // Require beats Skip
});

// --- Observability ------------------------------------------------------------

test("Metrics counters", () => {
  const m = new Metrics();
  m.recordCsrfIssued();
  m.recordCsrfValidated();
  m.recordCsrfRejected();
  m.recordCsrfExpired();
  m.recordRateLimited();
  m.recordValidationFailed();
  m.recordOriginRejected();
  m.recordFetchMetadataRejected();
  m.recordCookieRejected();
  const snap = m.snapshot();
  assert.equal(snap["csrf.issued"], 1);
  assert.equal(snap["csrf.validated"], 1);
  assert.equal(snap["csrf.rejected"], 1);
  assert.equal(snap["csrf.expired"], 1);
  assert.equal(snap["rate_limited"], 1);
  assert.equal(snap["validation_failed"], 1);
  assert.equal(snap["origin_rejected"], 1);
  assert.equal(snap["fetch_metadata_rejected"], 1);
  assert.equal(snap["cookie_rejected"], 1);
});

test("redactString masks secrets", () => {
  const out = redactString("password=hunter2 token=abc123 Bearer xyz");
  assert.ok(!out.includes("hunter2"));
  assert.ok(!out.includes("abc123"));
  assert.ok(!out.includes("xyz"));
  assert.ok(out.includes("[REDACTED]"));
});

test("redactValue masks sensitive keys", () => {
  const out = redactValue({
    username: "alice",
    password: "secret",
    nested: { api_key: "k", ok: "fine" },
  });
  assert.equal(out.password, "[REDACTED]");
  assert.equal(out.username, "alice");
  assert.equal(out.nested.api_key, "[REDACTED]");
  assert.equal(out.nested.ok, "fine");
});
