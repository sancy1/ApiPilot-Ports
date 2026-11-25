// filepath: src/csrf-format.ts
// layer: Security | package: @apipilot/core | since: v0.1.0
// purpose: CSRF token plaintext payload codec — mirrors CsrfTokenFormat (pre-protection format).
// -----------------------------------------------------------------------------
// RELATIONSHIPS
//   Used by    : adapters' CSRF signer, conformance runner
//   See also   : docs/csrf.md#the-token-format (C# reference)
// -----------------------------------------------------------------------------

/**
 * The CSRF token plaintext payload format (inside the signing envelope):
 *   `{issuedAtUnixSeconds}|{randomBase64Url}|{bindingFingerprint}`
 *
 * This module performs NO cryptography — it only encodes/decodes the
 * plaintext structure. The wire token is the output of the language's
 * AEAD/MAC protector applied to this payload.
 */
export const CSRF_DELIMITER = "|";

/** Unix-seconds bounds mirroring DateTimeOffset.ToUnixTimeSeconds() range. */
const MIN_UNIX_SECONDS = -62135596800;
const MAX_UNIX_SECONDS = 253402300799;

export interface CsrfPayloadParts {
  issuedAtUnixSeconds: number;
  randomBase64Url: string;
  bindingFingerprint: string;
}

/**
 * Encodes payload parts into the pipe-delimited plaintext.
 * @throws {Error} on empty parts, delimiter inside parts, or non-integer time.
 */
export function encodeCsrfPayload(
  issuedAtUnixSeconds: number,
  randomBase64Url: string,
  bindingFingerprint: string,
): string {
  if (!Number.isInteger(issuedAtUnixSeconds)) {
    throw new Error("issuedAtUnixSeconds must be an integer.");
  }
  if (randomBase64Url.length === 0) throw new Error("randomBase64Url must not be empty.");
  if (bindingFingerprint.length === 0) throw new Error("bindingFingerprint must not be empty.");
  if (randomBase64Url.includes(CSRF_DELIMITER)) {
    throw new Error("randomBase64Url must not contain the pipe delimiter.");
  }
  if (bindingFingerprint.includes(CSRF_DELIMITER)) {
    throw new Error("bindingFingerprint must not contain the pipe delimiter.");
  }
  return `${issuedAtUnixSeconds}${CSRF_DELIMITER}${randomBase64Url}${CSRF_DELIMITER}${bindingFingerprint}`;
}

/**
 * Decodes a pipe-delimited payload. Returns null on any structural violation.
 * Mirrors CsrfTokenFormat.TryDecode.
 */
export function tryDecodeCsrfPayload(payload: string): CsrfPayloadParts | null {
  if (payload.length === 0) return null;

  const parts = payload.split(CSRF_DELIMITER);
  if (parts.length !== 3) return null;

  const [timeRaw, random, binding] = parts as [string, string, string];
  if (timeRaw.length === 0 || random.length === 0 || binding.length === 0) return null;
  if (!/^[+-]?\d+$/.test(timeRaw)) return null;

  const issuedAt = Number.parseInt(timeRaw, 10);
  if (!Number.isSafeInteger(issuedAt)) return null;
  if (issuedAt < MIN_UNIX_SECONDS || issuedAt > MAX_UNIX_SECONDS) return null;

  return { issuedAtUnixSeconds: issuedAt, randomBase64Url: random, bindingFingerprint: binding };
}
