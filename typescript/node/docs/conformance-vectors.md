# Conformance vectors

The TypeScript port runs the same 251 language-neutral conformance vectors
as the C# and Go ports — proving wire-contract parity.

## Runner

```sh
npm run conformance   # core vectors + adapter wire-contract tests
```

The core suite (`../core/test/conformance.mjs`) reads
`../core/conformance/vectors/*.json`; the adapter suite
(`test/conformance-adapter.mjs`) exercises the middleware over real HTTP
and asserts the same wire contracts.

## Vector format

Each vector is a JSON file with:

- `name` — vector identifier.
- `request` — method, path, headers, body.
- `expected` — status, headers, body (envelope shape).

Vectors cover: correlation, content negotiation, origin, fetch
metadata, cookies, CSRF (bootstrap, validate, expire, binding),
pagination, rate limiting, error envelopes, validation errors.

## Adding vectors

Vectors are language-neutral — add them to the shared
`conformance/vectors/` directory; all ports pick them up automatically.
