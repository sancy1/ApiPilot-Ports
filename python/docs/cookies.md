# Cookies

ApiPilot validates **cookie profiles at startup** — it never sets a
cookie and never inspects request cookies. The profiles are a
declaration the application applies to its own cookie configuration.
An invalid profile **fails fast** when `ApiPilotOptions` is constructed
(mirroring `CookieProfileOptionsValidator` in C#).

## The three default profiles

| Role | `name` | `secure` | `http_only` | `same_site` | `path` | `domain` |
| --- | --- | --- | --- | --- | --- | --- |
| `auth` | `auth` | True | True | `"lax"` | `/` | `None` (host-only) |
| `session` | `session` | True | True | `"strict"` | `/` | `None` |
| `csrf` | `csrf` | True | **False** | `"lax"` | `/` | `None` |

The CSRF profile is only meaningful with the double-submit pattern;
applications holding the token in memory don't need it.

## `CookieProfile` fields

`name`, `secure`, `http_only`, `same_site` (`"lax"`/`"none"`/`"strict"`),
`path`, `domain` (`None` = host-only), `name_prefix`
(`""`, `"__Host-"`, `"__Secure-"`). The effective name is
`name_prefix + name`.

## Validation rules

- Effective name non-empty; no RFC 6265-forbidden chars
  (control chars, whitespace, `"` `,` `;` `\`).
- `path` non-empty and starts with `/`.
- `domain`, when set, is a valid hostname (no scheme/path/port/whitespace).
- `same_site` must be a defined value; `"none"` requires `secure=True`.
- `__Host-` prefix requires `secure`, no `domain`, `path="/"`.
- `__Secure-` prefix requires `secure`.

Violations are reported as codes, e.g. `samesite-none-requires-secure`,
`host-prefix-requires-no-domain`, `invalid-domain`.

## Fail-fast behavior

```python
from apipilot.asgi.options import ApiPilotOptions, CookieProfilesOptions
from apipilot.cookie_profile import CookieProfile

# Raises ValueError at construction:
#   Invalid cookie profile configuration: auth: samesite-none-requires-secure
ApiPilotOptions(cookies=CookieProfilesOptions(
    auth=CookieProfile(
        name="auth", secure=False, http_only=True,
        same_site="none", path="/", domain=None,
    ),
))
```

`ApiPilotOptions.__post_init__` validates all three roles. The same
options class is shared by the ASGI and WSGI adapters, so both fail
fast identically.

## Custom profiles

```python
ApiPilotOptions(cookies=CookieProfilesOptions(
    session=CookieProfile(
        name="sid", secure=True, http_only=True,
        same_site="strict", path="/", domain=None,
        name_prefix="__Host-",  # requires secure + no domain + path "/"
    ),
))
```
