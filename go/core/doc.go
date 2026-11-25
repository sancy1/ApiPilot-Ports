// Package core implements the ApiPilot wire contract in Go.
//
// It mirrors ApiPilot.Core (C#) and @apipilot/core (TypeScript):
// envelopes, error codes, pagination, validation field keys, origin,
// fetch-metadata, cookie profiles, CSRF format/binding, correlation,
// and content negotiation. All logic is framework-neutral and pinned
// by the shared conformance vectors.
package core
