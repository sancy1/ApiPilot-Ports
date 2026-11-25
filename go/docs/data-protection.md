# Data protection

The C# port uses ASP.NET Data Protection for CSRF token encryption. The
Go port uses HMAC-SHA256 with a key ring — the wire format is identical
(payload + signature), only the key source differs.

## Key ring (`httpapi.CsrfKeyRing`)

```go
type CsrfKeyRing struct {
    ActiveKeyID string
    Keys        map[string]string // keyID → base64 AES-256 key
}
```

- `ActiveKeyID` signs new tokens.
- All keys in `Keys` verify existing tokens (rotation support).
- `KeyRingFromEnv()` reads `APIPILOT_CSRF_KEYS`:
  `{"activeKeyId":"k1","keys":{"k1":"<base64>"}}`.
- `GenerateKeyMaterial()` → 32-byte base64 key.

## Rotation

1. Generate new key material.
2. Add to `Keys` with a new `keyID`; set `ActiveKeyID` to it.
3. Deploy — old tokens still verify via the old key.
4. After `TokenLifetimeSeconds`, remove the old key.

## Security notes

- Keys are secrets — store in a secrets manager, never in code or VCS.
- HMAC-SHA256 is used for signing; the payload is not encrypted (the
  binding fingerprint is not secret).
- Key compromise → rotate immediately; all outstanding tokens become
  invalid.
