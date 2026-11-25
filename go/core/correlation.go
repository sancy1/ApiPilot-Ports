package core

import (
	"crypto/rand"
	"regexp"
	"time"
)

// CorrelationInvalidIDPolicy is the invalid-ID policy.
type CorrelationInvalidIDPolicy string

const (
	InvalidIDReplace CorrelationInvalidIDPolicy = "replace"
	InvalidIDReject  CorrelationInvalidIDPolicy = "reject"
	InvalidIDUseAsIs CorrelationInvalidIDPolicy = "useAsIs"
)

// CorrelationOptions is the correlation policy configuration.
type CorrelationOptions struct {
	HeaderName           string
	ValidationPattern    *regexp.Regexp
	InvalidIDPolicy      CorrelationInvalidIDPolicy
	EchoInResponseHeader bool
	EchoInResponseBody   bool
}

// DefaultValidationPattern matches GUIDv7-shaped or generic safe tokens.
var DefaultValidationPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$`)

// DefaultCorrelationOptions returns the default options.
func DefaultCorrelationOptions() CorrelationOptions {
	return CorrelationOptions{
		HeaderName:           "X-Request-Id",
		ValidationPattern:    DefaultValidationPattern,
		InvalidIDPolicy:      InvalidIDReplace,
		EchoInResponseHeader: true,
		EchoInResponseBody:   true,
	}
}

// CorrelationDecisionKind identifies the decision outcome.
type CorrelationDecisionKind string

const (
	DecisionUseIncoming CorrelationDecisionKind = "use-incoming"
	DecisionGenerate    CorrelationDecisionKind = "generate"
	DecisionReject      CorrelationDecisionKind = "reject"
)

// CorrelationDecision is the decision result.
type CorrelationDecision struct {
	Kind CorrelationDecisionKind
	ID   string
	Warn bool
}

// ResolveCorrelationID decides the effective correlation ID for a request.
// Mirrors CorrelationMiddleware:
//   - absent header → generate
//   - present + pattern match → use incoming
//   - present + no match → policy: replace→generate, reject→reject, useAsIs→use+warn
func ResolveCorrelationID(headerValue *string, options CorrelationOptions, patternMatches bool) CorrelationDecision {
	if headerValue == nil || *headerValue == "" {
		return CorrelationDecision{Kind: DecisionGenerate}
	}
	if patternMatches {
		return CorrelationDecision{Kind: DecisionUseIncoming, ID: *headerValue}
	}
	switch options.InvalidIDPolicy {
	case InvalidIDReject:
		return CorrelationDecision{Kind: DecisionReject}
	case InvalidIDUseAsIs:
		return CorrelationDecision{Kind: DecisionUseIncoming, ID: *headerValue, Warn: true}
	default:
		return CorrelationDecision{Kind: DecisionGenerate}
	}
}

// GenerateGUIDv7 generates a GUIDv7 correlation ID (RFC 9562, time-ordered).
func GenerateGUIDv7() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failure is catastrophic; fall back to time-based bytes.
		now := time.Now().UnixMilli()
		for i := 0; i < 16; i++ {
			b[i] = byte(now >> (8 * i))
		}
	}

	now := uint64(time.Now().UnixMilli())
	// 48-bit big-endian unix_ts_ms into bytes 0-5
	for i := 0; i < 6; i++ {
		b[i] = byte(now >> (40 - 8*i))
	}
	// version 7 in high nibble of byte 6
	b[6] = (b[6] & 0x0f) | 0x70
	// variant 10xx in high bits of byte 8
	b[8] = (b[8] & 0x3f) | 0x80

	const hexdigits = "0123456789abcdef"
	hex := make([]byte, 32)
	for i, v := range b {
		hex[i*2] = hexdigits[v>>4]
		hex[i*2+1] = hexdigits[v&0x0f]
	}
	return string(hex[0:8]) + "-" + string(hex[8:12]) + "-" + string(hex[12:16]) +
		"-" + string(hex[16:20]) + "-" + string(hex[20:32])
}
