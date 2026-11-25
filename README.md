# ApiPilot-Ports

Behavioral ports of the **ApiPilot** C# library to TypeScript, Python, and Go.
Every port implements the same wire contract — verified by a shared set of
**107 conformance vectors / 251 assertions** that all four implementations
(C#, TypeScript, Python, Go) pass identically.

## Published packages

| Port | Package | Registry | Version | Install |
|---|---|---|---|---|
| Go | `github.com/sancy1/ApiPilot-Ports/go/core` + `/httpapi` | [pkg.go.dev](https://pkg.go.dev/github.com/sancy1/ApiPilot-Ports/go@v0.1.1) | `v0.1.1` | `go get github.com/sancy1/ApiPilot-Ports/go/httpapi@v0.1.1` |
| Python | `apipilot` | [PyPI](https://pypi.org/project/apipilot/) | `0.1.0` | `pip install apipilot` (`[asgi]` / `[wsgi]` extras) |
| TypeScript | `@apipilot/core` | [npm](https://www.npmjs.com/package/@apipilot/core) | `0.1.0` | `npm install @apipilot/core` |
| TypeScript | `@apipilot/node` (Express/Connect/raw Node) | [npm](https://www.npmjs.com/package/@apipilot/node) | `0.1.0` | `npm install @apipilot/node` |
| TypeScript | `@apipilot/fastify` | [npm](https://www.npmjs.com/package/@apipilot/fastify) | `0.1.0` | `npm install @apipilot/fastify` |
| TypeScript | `@apipilot/hono` | [npm](https://www.npmjs.com/package/@apipilot/hono) | `0.1.0` | `npm install @apipilot/hono` |
| TypeScript | `@apipilot/next` (Next.js App Router) | [npm](https://www.npmjs.com/package/@apipilot/next) | `0.1.0` | `npm install @apipilot/next` |

## Documentation

Auto-generated API docs are deployed to **GitHub Pages** on every push to `main`
(`.github/workflows/pages.yml`):

| Port | Docs | Generator |
|---|---|---|
| All ports index | https://sancy1.github.io/ApiPilot-Ports/ | — |
| TypeScript core | https://sancy1.github.io/ApiPilot-Ports/typescript/core/ | TypeDoc |
| TypeScript node | https://sancy1.github.io/ApiPilot-Ports/typescript/node/ | TypeDoc |
| TypeScript fastify | https://sancy1.github.io/ApiPilot-Ports/typescript/fastify/ | TypeDoc |
| TypeScript hono | https://sancy1.github.io/ApiPilot-Ports/typescript/hono/ | TypeDoc |
| TypeScript next | https://sancy1.github.io/ApiPilot-Ports/typescript/next/ | TypeDoc |
| Python | https://sancy1.github.io/ApiPilot-Ports/python/ | Sphinx |
| Go | https://pkg.go.dev/github.com/sancy1/ApiPilot-Ports/go@v0.1.1 | `go doc` / pkg.go.dev |

Hand-written guides live in each port's `docs/` directory (pagination, CSRF,
correlation, origin policy, fetch metadata, OpenAPI, filtering/sorting, …).

## Layout

```
ApiPilot-Ports/
├── typescript/
│   ├── core/        @apipilot/core   — pure logic (envelopes, pagination,
│   │                                 CSRF format/binding, correlation,
│   │                                 content negotiation, origin, cookies)
│   ├── fastify/     @apipilot/fastify — Fastify adapter (middleware, CSRF,
│   │                                 envelopes, exception mapping)
│   ├── node/        @apipilot/node    — generic node:http adapter
│   │                                 (Express, polka, Koa, raw Node,
│   │                                 NestJS-Express middleware)
│   └── hono/        @apipilot/hono    — Hono adapter (web Request model;
│                                       Node/Bun/Deno/Workers)
│   └── next/        @apipilot/next    — Next.js adapter (App Router route
│                                       handlers + Pages Router)
├── python/
│   └── src/apipilot/ — core package + asgi/ adapter (FastAPI, Starlette,
│                       Django-ASGI, any ASGI framework)
└── go/
    ├── core/        github.com/sancy1/ApiPilot-Ports/go/core    — pure logic
    └── httpapi/     github.com/sancy1/ApiPilot-Ports/go/httpapi — net/http adapter
```

## Conformance

The vectors live in `typescript/core/conformance/vectors/` and are the
single source of truth (see `docs/conformance-vectors.md` in the C# repo).

| Language | Core runner | Result | Adapter tests |
|---|---|---|---|
| TypeScript | `node typescript/core/test/conformance.mjs` | 251/251 | `node typescript/fastify/test/integration.mjs` — 12 pass |
| Python | `python python/tests/conformance_runner.py` | 251/251 | `pytest python/tests` — 9 pass |
| Go | `go run ./cmd/conformance` (in `go/`) | 251/251 | `go test ./httpapi/` — 9 pass |

## What is ported

- **Envelopes** — success / paginated / error shapes with `meta.requestId`.
- **Error codes** — 14 standard codes + normalization.
- **Pagination** — page/pageSize/sort/direction/filter parsing, wire↔internal
  page mapping, pagination math.
- **Validation keys** — field-key normalization + custom transforms.
- **Origin** — RFC 6454 origin parse + exact/anyPortSameHost matching.
- **Fetch metadata** — Sec-Fetch-Site/Mode policy (off/compat/strict).
- **Cookie profiles** — auth/session/csrf validation rules.
- **CSRF** — AES-256-GCM protector + key ring + purpose isolation, pipe-
  delimited payload codec, SHA-256 binding fingerprint, bootstrap endpoint,
  token lifecycle (7200s, 32-byte entropy).
- **Correlation** — GUIDv7 generation, header policy (replace/reject/useAsIs).
- **Content negotiation** — Accept → 406, Content-Type → 415.

## Docs

- `typescript/core/README.md`, `typescript/fastify/README.md`,
  `typescript/node/README.md`
- `python/README.md`
- `go/README.md`
- `docs/GENERATION.md` — autogenerated API docs (single source of truth)

## Generated API docs

Doc comments are the source of truth; API reference output is generated:

| Port | Generator | Command |
|---|---|---|
| Python | Sphinx + autodoc | `cd python && make apidocs` |
| TypeScript | TypeDoc | `cd typescript/<pkg> && npm run docs:api` |
| Go | `cmd/apidoc` (go/ast) | `cd go && make apidocs` |

Freshness gate (run in CI — regenerates everything and diffs):

```sh
python scripts/check_docs.py
```

## Examples

- `typescript/node/examples/` — Express, Koa, and raw `node:http` servers
- `typescript/hono/examples/` — Hono server
- `typescript/next/examples/` — Next.js App Router + Pages Router route files
- `python/samples/` — FastAPI, Starlette, and Django (ASGI) apps; `apipilot.wsgi` covers Flask/Django-WSGI
- `go/examples/chi/` — Chi router with the full pipeline
