# Cookies

ApiPilot validates **cookie profiles at startup** — it never sets a
cookie and never inspects request cookies. The profiles are a
declaration the application applies to its own cookie configuration.
An invalid profile **fails fast** when `httpapi.New` is called
(mirroring `CookieProfileOptionsValidator` in C#).

## The three default profiles

| Role | `Name` | `Secure` | `HTTPOnly` | `SameSite` | `Path` | `Domain` |
| --- | --- | --- | --- | --- | --- | --- |
| `auth` | `auth` | true | true | `lax` | `/` | `nil` (host-only) |
| `session` | `session` | true | true | `strict` | `/` | `nil` |
| `csrf` | `csrf` | true | **false** | `lax` | `/` | `nil` |

The CSRF profile is only meaningful with the double-submit pattern;
applications holding the token in memory don't need it.

## `core.CookieProfile` fields

`Name`, `Secure`, `HTTPOnly`, `SameSite` (`core.SameSiteLax` /
`SameSiteNone` / `SameSiteStrict`), `Path`, `Domain` (`*string`,
`nil` = host-only), `NamePrefix` (`""`, `"__Host-"`, `"__Secure-"`).
The effective name is `NamePrefix + Name`.

## Validation rules

- Effective name non-empty; no RFC 6265-forbidden chars
  (control chars, whitespace, `"` `,` `;` `\`).
- `Path` non-empty and starts with `/`.
- `Domain`, when set, is a valid hostname (no scheme/path/port/whitespace).
- `SameSite` must be a defined value; `SameSiteNone` requires `Secure`.
- `__Host-` prefix requires `Secure`, no `Domain`, `Path="/"`.
- `__Secure-` prefix requires `Secure`.

Violations are reported as codes, e.g. `samesite-none-requires-secure`,
`host-prefix-requires-no-domain`, `invalid-domain`.

## Fail-fast behavior

```go
opts := httpapi.DefaultOptions()
opts.Cookies.Auth.Secure = false
opts.Cookies.Auth.SameSite = core.SameSiteNone

// Returns error:
//   httpapi: invalid cookie profile configuration:
//   auth: samesite-none-requires-secure
mw, err := httpapi.New(opts, nil, nil)
```

`New` validates all three roles before constructing the middleware.

## Custom profiles

```go
opts.Cookies.Session = core.CookieProfile{
    Name:       "sid",
    Secure:     true,
    HTTPOnly:   true,
    SameSite:   core.SameSiteStrict,
    Path:       "/",
    Domain:     nil,
    NamePrefix: "__Host-", // requires Secure + no Domain + Path "/"
}
```
