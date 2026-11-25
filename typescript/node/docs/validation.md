# Validation

ApiPilot's validation contract is the `VALIDATION_ERROR` envelope with
`error.fields` — a map of normalized field key → list of messages.

## Field key normalization (`normalizeFieldKey`)

| Input | Output |
| --- | --- |
| `$.User.Name` | `user.name` |
| `User.Name` | `user.name` |
| `Items[0].Name` | `items[0].name` |
| `user_name` | `user_name` (unchanged) |
| `""` | `""` |

Rules:

- Leading `$.` JSONPath prefix is stripped.
- Dot-separated segments are lowercased.
- Bracket index segments (`[0]`) are preserved verbatim.
- Custom transform via `resolveKeyTransform(custom)` — the custom
  function wins when provided.

## Envelope

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more values are invalid.",
    "fields": { "user.name": ["required"] }
  },
  "meta": { "requestId": "..." }
}
```

- Default message: `"One or more values are invalid."` — applied when the
  message is empty or whitespace-only (mirrors C#
  `ValidationResponseFactory.DefaultMessage`).
- `fields` values are arrays; multiple messages per field are allowed.
- HTTP status is 400.

## TypeScript usage

```ts
const fields = { "user.name": ["required"] };
sendValidationError(req, res, fields, ""); // empty message → default
```

Pagination query failures reuse the same envelope via
`parsePaginationQuery` errors.
