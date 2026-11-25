# Cookies

ApiPilot validates **cookie profiles at startup** — it never sets a
cookie and never inspects request cookies. The profiles are a
declaration the application applies to its own cookie configuration.
An invalid profile **fails fast** when the adapter options are resolved
(mirroring `CookieProfileOptionsValidator` in C#).

## The three default profiles

| Role | `name` | `secure` | `httpOnly` | `sameSite` | `path` | `domain` |
| --- | --- | --- | --- | --- | --- | --- |
| `auth` | `auth` | true | true | `lax` | `/` | `null` (host-only) |
| `session` | `session` | true | true | `strict` | `/` | `null` |
| `csrf` | `csrf` | true | **false** | `lax` | `/` | `null` |

The CSRF profile is only meaningful with the double-submit pattern;
applications holding the token in memory don't need it.

## `CookieProfile` fields

`name`, `secure`, `httpOnly`, `sameSite` (`lax`/`none`/`strict`),
`path`, `domain` (`null` = host-only), `namePrefix`
(`""`, `"__Host-"`, `"__Secure-"`). The effective name is
`namePrefix + name`.

## Validation rules

- Effective name non-empty; no RFC 6265-forbidden chars
  (control chars, whitespace, `"` `,` `;` `\`).
- `path` non-empty and starts with `/`.
- `domain`, when set, is a valid hostname (no scheme/path/port/whitespace).
- `sameSite` must be a defined value; `none` requires `secure: true`.
- `__Host-` prefix requires `secure`, no `domain`, `path: "/"`.
- `__Secure-` prefix requires `secure`.

Violations are reported as codes, e.g. `samesite-none-requires-secure`,
`host-prefix-requires-no-domain`, `invalid-domain`.

## Fail-fast behavior

```ts
import { apiPilot } from "@apipilot/node";

// Throws at startup:
//   Error: Invalid cookie profile configuration:
//   auth: samesite-none-requires-secure
apiPilot({
  cookies: {
    auth: { secure: false, sameSite: "none" }, // partial override merged
  },
});
```

`resolveOptions()` merges each profile over `DEFAULT_COOKIE_PROFILES`
then validates all three roles. The same validation runs for
`@apipilot/fastify`, and automatically for `@apipilot/hono` and
`@apipilot/next` (both reuse the node options resolver).

## Custom profiles

```ts
apiPilot({
  cookies: {
    session: {
      name: "sid",
      secure: true,
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      domain: null,
      namePrefix: "__Host-", // requires secure + no domain + path "/"
    },
  },
});
```
