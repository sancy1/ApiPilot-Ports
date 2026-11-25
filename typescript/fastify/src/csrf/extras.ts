// filepath: src/csrf/extras.ts
// layer: Security | package: @apipilot/fastify | since: v0.2.0
// purpose: CSRF extras — rotation store, transition listener, endpoint
//          policy resolver. Mirrors ICsrfRotationStore,
//          DefaultCsrfTransitionListener, CsrfEndpointPolicyResolver (C#).
// -----------------------------------------------------------------------------
// A rotation marker is the Unix-seconds timestamp of the last rotation for
// a binding. A token whose issue time is before the marker is rejected with
// outcome "rotated". The store is optional; when absent the service
// operates in expiry-only rotation mode.
// -----------------------------------------------------------------------------

import type { FastifyRequest } from "fastify";
import type { CsrfService } from "./service.js";
import type { CsrfBindingResolver } from "./binding.js";

// ---------------------------------------------------------------------------
// Rotation store
// ---------------------------------------------------------------------------

/** Persists rotation markers per binding fingerprint. */
export interface RotationStore {
  /** Returns the last-rotation Unix timestamp, or undefined. */
  getRotationMarker(binding: string): number | undefined;
  /** Records a rotation marker for the binding. */
  setRotationMarker(binding: string, unixSeconds: number): void;
  /** Removes the marker for the binding. */
  clearRotationMarker(binding: string): void;
}

/** Process-local RotationStore. */
export class InMemoryRotationStore implements RotationStore {
  private readonly markers = new Map<string, number>();

  getRotationMarker(binding: string): number | undefined {
    return this.markers.get(binding);
  }

  setRotationMarker(binding: string, unixSeconds: number): void {
    this.markers.set(binding, unixSeconds);
  }

  clearRotationMarker(binding: string): void {
    this.markers.delete(binding);
  }
}

// ---------------------------------------------------------------------------
// Service rotation wiring
// ---------------------------------------------------------------------------

const ROTATION_STORE = Symbol("apipilot.csrf.rotationStore");

/** Attaches a rotation store to the service. Returns the service. */
export function attachRotationStore<T extends CsrfService>(service: T, store: RotationStore): T {
  (service as unknown as Record<symbol, unknown>)[ROTATION_STORE] = store;
  return service;
}

/** Returns "rotated" when the token predates the binding's rotation marker. */
export function checkRotation(
  service: CsrfService,
  bindingFingerprint: string,
  issuedAtUnixSeconds: number,
): "rotated" | null {
  const store = (service as unknown as Record<symbol, unknown>)[ROTATION_STORE] as RotationStore | undefined;
  if (store === undefined) return null;
  const marker = store.getRotationMarker(bindingFingerprint);
  if (marker !== undefined && issuedAtUnixSeconds < marker) return "rotated";
  return null;
}

/** Records a rotation marker for the binding at the current time. */
export function markRotated(service: CsrfService, bindingFingerprint: string): void {
  const store = (service as unknown as Record<symbol, unknown>)[ROTATION_STORE] as RotationStore | undefined;
  store?.setRotationMarker(bindingFingerprint, Math.floor(Date.now() / 1000));
}

// ---------------------------------------------------------------------------
// Transition listener
// ---------------------------------------------------------------------------

/**
 * Issues fresh tokens on login and clears rotation markers on logout.
 * Never authenticates users or writes cookies — the application owns its
 * session lifecycle. Mirrors DefaultCsrfTransitionListener.
 */
export class CsrfTransitionListener {
  constructor(
    private readonly service: CsrfService,
    private readonly bindingResolver: CsrfBindingResolver,
    private readonly rotationStore?: RotationStore,
  ) {}

  /** Resolves the binding for the request and issues a fresh token.
   *  Returns null when no binding can be resolved — fail closed. */
  onLogin(request: FastifyRequest): string | null {
    const binding = this.bindingResolver.resolve(request);
    if (binding === null) return null;
    return this.service.issueToken(binding.source, binding.kind);
  }

  /** Issues a fresh token for an explicit binding. */
  onLoginWithBinding(source: string, kind: "subject" | "session" | "preauth"): string {
    return this.service.issueToken(source, kind);
  }

  /** Clears the rotation marker for the request's binding when a store is
   *  registered. Safe before or after session teardown. */
  onLogout(request: FastifyRequest): void {
    if (this.rotationStore === undefined) return;
    const binding = this.bindingResolver.resolve(request);
    if (binding !== null) {
      this.rotationStore.clearRotationMarker(binding.fingerprint);
    }
  }

  /** Clears the rotation marker for an explicit binding fingerprint. */
  onLogoutWithFingerprint(fingerprint: string): void {
    if (this.rotationStore !== undefined && fingerprint !== "") {
      this.rotationStore.clearRotationMarker(fingerprint);
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint policy resolver
// ---------------------------------------------------------------------------

export type CsrfEndpointPolicy = "useGlobal" | "require" | "skip";

/**
 * Combines per-route flags into the effective policy.
 * Precedence: Require > Skip > UseGlobal — mirrors
 * CsrfEndpointPolicyResolver. Later flags do not override earlier ones
 * of higher precedence.
 */
export function resolveEndpointPolicy(require: boolean, skip: boolean): CsrfEndpointPolicy {
  if (require) return "require";
  if (skip) return "skip";
  return "useGlobal";
}
