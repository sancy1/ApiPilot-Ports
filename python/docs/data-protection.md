# Data protection

The C# port uses ASP.NET Data Protection for CSRF token encryption. The
Python port uses HMAC-SHA256 with a key ring — the wire format is
identical (payload + signature), only the key source differs.

## Key ring (`CsrfKeyRing`)

```python
@dataclass
class CsrfKeyRing:
    active_key_id: str
    keys: dict[str, str]  # keyID → base64 AES-256 key
```

- `active_key_id` signs new tokens.
- All keys in `keys` verify existing tokens (rotation support).
- `key_ring_from_env()` reads `APIPILOT_CSRF_KEYS`:
  `{"activeKeyId":"k1","keys":{"k1":"<base64>"}}`.
- `generate_key_material()` → 32-byte base64 key.

## Rotation

1. Generate new key material.
2. Add to `keys` with a new `key_id`; set `active_key_id` to it.
3. Deploy — old tokens still verify via the old key.
4. After `token_lifetime_seconds`, remove the old key.

## Security notes

- Keys are secrets — store in a secrets manager, never in code or VCS.
- HMAC-SHA256 is used for signing; the payload is not encrypted (the
  binding fingerprint is not secret).
- Key compromise → rotate immediately; all outstanding tokens become
  invalid.
