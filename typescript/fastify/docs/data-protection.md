# Data protection

The C# port uses ASP.NET Data Protection for CSRF token encryption. The
TypeScript port uses HMAC-SHA256 with a key ring — the wire format is
identical (payload + signature), only the key source differs.

## Key ring (`CsrfKeyRing`)

```ts
interface CsrfKeyRing {
  activeKeyId: string;
  keys: Record<string, string>; // keyID → base64 AES-256 key
}
```

- `activeKeyId` signs new tokens.
- All keys in `keys` verify existing tokens (rotation support).
- `keyRingFromEnv()` reads `APIPILOT_CSRF_KEYS`:
  `{"activeKeyId":"k1","keys":{"k1":"<base64>"}}`.
- `generateKeyMaterial()` → 32-byte base64 key.

## Rotation

1. Generate new key material.
2. Add to `keys` with a new `keyId`; set `activeKeyId` to it.
3. Deploy — old tokens still verify via the old key.
4. After `tokenLifetimeSeconds`, remove the old key.

## Security notes

- Keys are secrets — store in a secrets manager, never in code or VCS.
- HMAC-SHA256 is used for signing; the payload is not encrypted (the
  binding fingerprint is not secret).
- Key compromise → rotate immediately; all outstanding tokens become
  invalid.
