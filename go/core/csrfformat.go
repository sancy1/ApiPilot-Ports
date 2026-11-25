package core

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// CSRF token plaintext payload codec — mirrors CsrfTokenFormat (C#).
//
// Wire format: {issuedAtUnixSeconds}|{randomBase64Url}|{bindingFingerprint}
// joined by "|" delimiters. NO cryptography here — the wire token is the
// output of the language's AEAD/MAC protector applied to this payload.

// CsrfDelimiter separates payload segments.
const CsrfDelimiter = "|"

// Unix-seconds bounds mirroring DateTimeOffset.ToUnixTimeSeconds() range.
const (
	MinUnixSeconds int64 = -62135596800
	MaxUnixSeconds int64 = 253402300799
)

var csrfTimeRe = regexp.MustCompile(`^[+-]?\d+$`)

// CsrfPayloadParts is a decoded plaintext payload.
type CsrfPayloadParts struct {
	IssuedAtUnixSeconds int64
	RandomBase64URL     string
	BindingFingerprint  string
}

// EncodeCsrfPayload encodes payload parts into the pipe-delimited plaintext.
// Returns an error on empty parts, delimiter inside parts, or non-integer time.
func EncodeCsrfPayload(issuedAtUnixSeconds int64, randomBase64URL, bindingFingerprint string) (string, error) {
	if randomBase64URL == "" {
		return "", fmt.Errorf("randomBase64Url must not be empty")
	}
	if bindingFingerprint == "" {
		return "", fmt.Errorf("bindingFingerprint must not be empty")
	}
	if containsByte(randomBase64URL, '|') {
		return "", fmt.Errorf("randomBase64Url must not contain the pipe delimiter")
	}
	if containsByte(bindingFingerprint, '|') {
		return "", fmt.Errorf("bindingFingerprint must not contain the pipe delimiter")
	}
	return strconv.FormatInt(issuedAtUnixSeconds, 10) + CsrfDelimiter +
		randomBase64URL + CsrfDelimiter + bindingFingerprint, nil
}

func containsByte(s string, b byte) bool {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return true
		}
	}
	return false
}

// TryDecodeCsrfPayload decodes a pipe-delimited payload.
// Returns (parts, true) or (zero, false). Deliberately lenient — only
// structure (3 non-empty parts, integer time in range) is checked.
// Mirrors CsrfTokenFormat.TryDecode.
func TryDecodeCsrfPayload(payload string) (CsrfPayloadParts, bool) {
	if payload == "" {
		return CsrfPayloadParts{}, false
	}

	parts := strings.Split(payload, CsrfDelimiter)
	if len(parts) != 3 {
		return CsrfPayloadParts{}, false
	}

	timeRaw, random, binding := parts[0], parts[1], parts[2]
	if timeRaw == "" || random == "" || binding == "" {
		return CsrfPayloadParts{}, false
	}
	if !csrfTimeRe.MatchString(timeRaw) {
		return CsrfPayloadParts{}, false
	}

	issuedAt, err := strconv.ParseInt(timeRaw, 10, 64)
	if err != nil {
		return CsrfPayloadParts{}, false
	}
	if issuedAt < MinUnixSeconds || issuedAt > MaxUnixSeconds {
		return CsrfPayloadParts{}, false
	}

	return CsrfPayloadParts{
		IssuedAtUnixSeconds: issuedAt,
		RandomBase64URL:     random,
		BindingFingerprint:  binding,
	}, true
}
