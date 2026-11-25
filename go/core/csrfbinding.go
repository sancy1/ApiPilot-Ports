package core

import (
	"crypto/sha256"
	"encoding/base64"
)

// CSRF binding fingerprint — mirrors CsrfBindingProvider.Fingerprint (C#).
//
// SHA-256 over "ApiPilot.Csrf.Binding.v1|" + prefixedSource (UTF-8),
// output as unpadded base64url (43 chars). The prefixed source is:
//   subject → source (raw)
//   session → "session:" + source
//   preauth → "preauth:" + source
//
// Deterministic across restarts and languages — pinned by known-answer
// vectors. Must match the TypeScript and Python ports byte-for-byte.

// CsrfBindingPurpose is mixed into every binding hash.
const CsrfBindingPurpose = "ApiPilot.Csrf.Binding.v1"

// CsrfBindingKind identifies the binding source kind.
type CsrfBindingKind string

const (
	BindingSubject CsrfBindingKind = "subject"
	BindingSession CsrfBindingKind = "session"
	BindingPreAuth CsrfBindingKind = "preauth"
)

// CsrfBindingFingerprint computes the binding fingerprint.
func CsrfBindingFingerprint(source string, kind CsrfBindingKind) string {
	var prefixed string
	switch kind {
	case BindingSession:
		prefixed = "session:" + source
	case BindingPreAuth:
		prefixed = "preauth:" + source
	default:
		prefixed = source
	}

	material := CsrfBindingPurpose + "|" + prefixed
	digest := sha256.Sum256([]byte(material))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}
