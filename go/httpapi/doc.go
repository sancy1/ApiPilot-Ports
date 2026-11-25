// Package httpapi is the ApiPilot net/http adapter.
//
// It implements the full ApiPilot request pipeline as http.Handler
// middleware: correlation → content-negotiation → origin →
// fetch-metadata → CSRF → exception mapping. Mirrors the C# pipeline,
// the TypeScript Fastify adapter, and the Python ASGI adapter.
package httpapi
