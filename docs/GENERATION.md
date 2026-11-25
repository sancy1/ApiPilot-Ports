# Documentation generation — single source of truth

ApiPilot follows the FlowSemantics model: **doc comments in code are the
single source of truth; generated API docs are build artifacts.**

Conceptual docs (`docs/*.md` — CSRF format, threat model, conformance,
deployment) stay curated by hand. Anything describing the **API surface**
(signatures, options, exports, members) is generated and must not be
edited by hand.

## Per-language generators

| Port | Source of truth | Generator | Command | Output |
| --- | --- | --- | --- | --- |
| C# | `/// <summary>` XML comments | `GenerateDocumentationFile` (active); DocFX site optional | `dotnet build` → `bin/*/ApiPilot.*.xml` | XML doc files (NuGet-shipped) |
| TypeScript | TSDoc `/** … */` | TypeDoc 0.28 | `npm run docs:api` (per package) | `<pkg>/apidocs/` (HTML) |
| Python | docstrings | Sphinx 9 + autodoc | `make apidocs` | `apidocs/_build/html` |
| Go | `//` doc comments | `cmd/apidoc` (go/ast, zero-dep) | `make apidocs` | `docs/api/*.md` |

## TypeScript packages

Each package has `typedoc.json` and a `docs:api` script:

```sh
cd typescript/core    && npm run docs:api   # → core/apidocs/
cd typescript/fastify && npm run docs:api   # → fastify/apidocs/
cd typescript/node    && npm run docs:api   # → node/apidocs/
```

`typedoc` is a devDependency (`^0.28.0`); `skipErrorChecking` is on so
docs build without a prior `tsc` pass.

## Python

```sh
cd python
pip install -e ".[docs]"     # sphinx>=7
make apidocs                  # → apidocs/_build/html
```

`apidocs/conf.py` puts `src/` on `sys.path` and uses
`sphinx.ext.autodoc` + `napoleon` + `viewcode`. The existing
`make docs` target (`scripts/gen_api_docs.py`) still produces the
markdown `docs/api-reference.md`.

## Go

```sh
cd go
make apidocs    # → docs/api/{core,httpapi}.md
```

`cmd/apidoc` parses `core/` and `httpapi/` with `go/parser`+`go/ast`
(stdlib only) and emits one Markdown page per package: package doc,
then every exported type/func/const/var with its doc comment and a
compact signature. `make docs` (`go doc`) still produces the single-file
`docs/api-reference.md`.

## Rules

- Never hand-edit generated output (`apidocs/`, `docs/api/*.md`,
  `site/`). Fix the doc comment and regenerate.
- New exported API without a doc comment will appear undocumented —
  treat missing docs as a review finding.
- CI should run the generators and fail on diff (staleness check):

  ```sh
  python scripts/check_docs.py   # repo root — regenerates all ports, diffs
  ```
