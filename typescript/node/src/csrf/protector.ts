// filepath: src/csrf/protector.ts
// layer: Security | package: @apipilot/fastify | since: v0.1.0
// purpose: CSRF token protector — the Data-Protection-equivalent cryptographic boundary.
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Used by    : csrf/service.ts
//   See also   : docs/csrf.md#cryptographic-boundary (C# reference)
// -----------------------------------------------------------------------------

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Protects and unprotects CSRF token payloads. This is the port's
 * equivalent of ASP.NET Core Data Protection: authenticated encryption
 * with a shared key ring and purpose isolation.
 *
 * Wire format (base64url):
 *   v1.<keyId>.<iv>.<ciphertext>.<tag>
 *
 * - AES-256-GCM for confidentiality + integrity.
// - The AAD binds the purpose string so a token protected for one
 *   purpose cannot be unprotected for another.
 * - keyId identifies which key-ring entry sealed the token, enabling
 *   rotation without invalidating in-flight tokens.
 */
export interface CsrfKeyRing {
  /** Active key id (used for new protections). */
  activeKeyId: string;
  /** keyId → 32-byte key material. */
  keys: Record<string, Buffer>;
}

export interface CsrfProtectorOptions {
  /** Purpose string for AAD isolation. Default "ApiPilot.Csrf.v1". */
  purpose: string;
}

const PURPOSE_DEFAULT = "ApiPilot.Csrf.v1";
const VERSION = "v1";

export class CsrfProtector {
  private readonly purpose: string;

  constructor(
    private readonly keyRing: CsrfKeyRing,
    options?: Partial<CsrfProtectorOptions>,
  ) {
    this.purpose = options?.purpose ?? PURPOSE_DEFAULT;
    if (!this.keyRing.keys[this.keyRing.activeKeyId]) {
      throw new Error("CsrfProtector: activeKeyId is not present in the key ring.");
    }
    for (const [id, key] of Object.entries(this.keyRing.keys)) {
      if (key.length !== 32) {
        throw new Error(`CsrfProtector: key "${id}" must be 32 bytes (AES-256).`);
      }
    }
  }

  /** Encrypts a UTF-8 payload into the wire token. */
  protect(plaintext: string): string {
    const key = this.keyRing.keys[this.keyRing.activeKeyId]!;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(this.purpose, "utf8"));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      VERSION,
      this.keyRing.activeKeyId,
      iv.toString("base64url"),
      ct.toString("base64url"),
      tag.toString("base64url"),
    ].join(".");
  }

  /**
   * Decrypts a wire token. Returns the plaintext or null on ANY failure
   * (malformed, unknown key, bad tag, wrong purpose). Never throws for
   * bad input — mirrors Data Protection's CryptographicException mapping.
   */
  unprotect(token: string): string | null {
    const parts = token.split(".");
    if (parts.length !== 5 || parts[0] !== VERSION) return null;

    const [, keyId, ivB64, ctB64, tagB64] = parts as [string, string, string, string, string];
    const key = this.keyRing.keys[keyId];
    if (!key) return null;

    try {
      const iv = Buffer.from(ivB64, "base64url");
      const ct = Buffer.from(ctB64, "base64url");
      const tag = Buffer.from(tagB64, "base64url");
      if (iv.length !== 12 || tag.length !== 16) return null;

      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(this.purpose, "utf8"));
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString("utf8");
    } catch {
      return null;
    }
  }
}

/**
 * Builds a key ring from environment variables — the multi-instance
 * contract equivalent. APIPILOT_CSRF_KEYS is a comma-separated list of
 * `keyId:base64key` pairs; APIPILOT_CSRF_ACTIVE_KEY selects the active id.
 * All instances sharing the same env config share the same ring.
 */
export function keyRingFromEnv(env: NodeJS.ProcessEnv = process.env): CsrfKeyRing {
  const raw = env.APIPILOT_CSRF_KEYS;
  const active = env.APIPILOT_CSRF_ACTIVE_KEY;
  if (!raw || !active) {
    throw new Error(
      "APIPILOT_CSRF_KEYS and APIPILOT_CSRF_ACTIVE_KEY are required for CSRF protection.",
    );
  }
  const keys: Record<string, Buffer> = {};
  for (const entry of raw.split(",")) {
    const idx = entry.indexOf(":");
    if (idx <= 0) throw new Error(`Malformed APIPILOT_CSRF_KEYS entry: "${entry}".`);
    const id = entry.slice(0, idx).trim();
    const key = Buffer.from(entry.slice(idx + 1).trim(), "base64");
    keys[id] = key;
  }
  return { activeKeyId: active.trim(), keys };
}

/** Generates a fresh 32-byte key, base64-encoded, for key-ring bootstrap. */
export function generateKeyMaterial(): string {
  return randomBytes(32).toString("base64");
}

/** Constant-time string comparison helper for token equality checks. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** HMAC-SHA256 helper retained for binding-adjacent uses. */
export function hmacSha256(key: Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}
