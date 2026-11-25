package httpapi

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/apipilot/go/core"
)

// CSRF protection — protector, key ring, service, binding.
// Mirrors the Python ASGI csrf.py / TypeScript csrf/* / C# CsrfProtector.
//
// Cryptographic boundary: AES-256-GCM with a shared key ring and purpose
// isolation. Wire format (base64url segments joined by "."):
//
//	v1.<keyId>.<iv>.<ciphertext>.<tag>

const (
	csrfPurposeDefault = "ApiPilot.Csrf.v1"
	csrfVersion        = "v1"
	csrfNonceSize      = 12
	csrfTagSize        = 16
)

// CsrfKeyRing holds the active key id plus keyId → 32-byte key material.
type CsrfKeyRing struct {
	ActiveKeyID string
	Keys        map[string][]byte
}

// CsrfProtector protects/unprotects CSRF token payloads.
type CsrfProtector struct {
	purpose string
	ring    *CsrfKeyRing
}

// NewCsrfProtector validates the ring and returns a protector.
func NewCsrfProtector(ring *CsrfKeyRing) (*CsrfProtector, error) {
	if ring == nil {
		return nil, errors.New("CsrfProtector: key ring is nil")
	}
	if _, ok := ring.Keys[ring.ActiveKeyID]; !ok {
		return nil, errors.New("CsrfProtector: active_key_id is not present in the key ring")
	}
	for kid, key := range ring.Keys {
		if len(key) != 32 {
			return nil, fmt.Errorf("CsrfProtector: key %q must be 32 bytes (AES-256)", kid)
		}
	}
	return &CsrfProtector{purpose: csrfPurposeDefault, ring: ring}, nil
}

// Protect encrypts a UTF-8 payload into the wire token.
func (p *CsrfProtector) Protect(plaintext string) (string, error) {
	key := p.ring.Keys[p.ring.ActiveKeyID]
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	iv := make([]byte, csrfNonceSize)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, iv, []byte(plaintext), []byte(p.purpose))
	ct, tag := sealed[:len(sealed)-csrfTagSize], sealed[len(sealed)-csrfTagSize:]
	return strings.Join([]string{
		csrfVersion,
		p.ring.ActiveKeyID,
		base64.RawURLEncoding.EncodeToString(iv),
		base64.RawURLEncoding.EncodeToString(ct),
		base64.RawURLEncoding.EncodeToString(tag),
	}, "."), nil
}

// Unprotect decrypts a wire token. Returns plaintext or "" on ANY failure.
func (p *CsrfProtector) Unprotect(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 5 || parts[0] != csrfVersion {
		return ""
	}
	_, keyID, ivB64, ctB64, tagB64 := parts[0], parts[1], parts[2], parts[3], parts[4]
	key, ok := p.ring.Keys[keyID]
	if !ok {
		return ""
	}
	iv, err1 := base64.RawURLEncoding.DecodeString(ivB64)
	ct, err2 := base64.RawURLEncoding.DecodeString(ctB64)
	tag, err3 := base64.RawURLEncoding.DecodeString(tagB64)
	if err1 != nil || err2 != nil || err3 != nil {
		return ""
	}
	if len(iv) != csrfNonceSize || len(tag) != csrfTagSize {
		return ""
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return ""
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return ""
	}
	sealed := append(append([]byte{}, ct...), tag...)
	plain, err := gcm.Open(nil, iv, sealed, []byte(p.purpose))
	if err != nil {
		return ""
	}
	return string(plain)
}

// KeyRingFromEnv builds a key ring from APIPILOT_CSRF_KEYS /
// APIPILOT_CSRF_ACTIVE_KEY. APIPILOT_CSRF_KEYS is a comma-separated list of
// "keyId:base64key" pairs.
func KeyRingFromEnv() (*CsrfKeyRing, error) {
	raw := os.Getenv("APIPILOT_CSRF_KEYS")
	active := os.Getenv("APIPILOT_CSRF_ACTIVE_KEY")
	if raw == "" || active == "" {
		return nil, errors.New("APIPILOT_CSRF_KEYS and APIPILOT_CSRF_ACTIVE_KEY are required for CSRF protection")
	}
	keys := map[string][]byte{}
	for _, entry := range strings.Split(raw, ",") {
		idx := strings.Index(entry, ":")
		if idx <= 0 {
			return nil, fmt.Errorf("malformed APIPILOT_CSRF_KEYS entry: %q", entry)
		}
		kid := strings.TrimSpace(entry[:idx])
		key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(entry[idx+1:]))
		if err != nil {
			return nil, fmt.Errorf("malformed APIPILOT_CSRF_KEYS entry %q: %w", kid, err)
		}
		keys[kid] = key
	}
	return &CsrfKeyRing{ActiveKeyID: strings.TrimSpace(active), Keys: keys}, nil
}

// GenerateKeyMaterial generates a fresh 32-byte key, base64-encoded.
func GenerateKeyMaterial() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.StdEncoding.EncodeToString(b)
}

// ---------------------------------------------------------------------------
// Binding resolution
// ---------------------------------------------------------------------------

// CsrfBindingResult is the resolved binding: fingerprint + raw source + kind.
type CsrfBindingResult struct {
	Fingerprint string
	Source      string
	Kind        string // "subject" | "session" | "preauth"
}

// BindingResolver resolves the CSRF binding for a request.
type BindingResolver interface {
	Resolve(r *http.Request) *CsrfBindingResult
}

// DefaultBindingResolver resolves subject → session → preauth. Never anonymous.
type DefaultBindingResolver struct {
	SubjectExtractor func(r *http.Request) string
	SessionExtractor func(r *http.Request) string
	PreAuthSource    func(r *http.Request) string
}

// Resolve implements BindingResolver.
func (d *DefaultBindingResolver) Resolve(r *http.Request) *CsrfBindingResult {
	if d.SubjectExtractor != nil {
		if s := d.SubjectExtractor(r); s != "" {
			return &CsrfBindingResult{
				Fingerprint: core.CsrfBindingFingerprint(s, core.BindingSubject),
				Source:      s, Kind: "subject",
			}
		}
	}
	if d.SessionExtractor != nil {
		if s := d.SessionExtractor(r); s != "" {
			return &CsrfBindingResult{
				Fingerprint: core.CsrfBindingFingerprint(s, core.BindingSession),
				Source:      s, Kind: "session",
			}
		}
	}
	if d.PreAuthSource != nil {
		if s := d.PreAuthSource(r); s != "" {
			return &CsrfBindingResult{
				Fingerprint: core.CsrfBindingFingerprint(s, core.BindingPreAuth),
				Source:      s, Kind: "preauth",
			}
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Token service
// ---------------------------------------------------------------------------

// CsrfValidationOutcome identifies the validation result.
type CsrfValidationOutcome string

const (
	OutcomeValid            CsrfValidationOutcome = "valid"
	OutcomeMissingToken     CsrfValidationOutcome = "missingToken"
	OutcomeInvalidSignature CsrfValidationOutcome = "invalidSignature"
	OutcomeMalformedPayload CsrfValidationOutcome = "malformedPayload"
	OutcomeExpired          CsrfValidationOutcome = "expired"
	OutcomeBindingMismatch  CsrfValidationOutcome = "bindingMismatch"
	OutcomeMissingBinding   CsrfValidationOutcome = "missingBinding"
	OutcomeRotated          CsrfValidationOutcome = "rotated"
)

// CsrfValidationResult is the validation outcome + optional fingerprint.
type CsrfValidationResult struct {
	Outcome            CsrfValidationOutcome
	BindingFingerprint string
}

// CsrfService issues and validates CSRF tokens. Stateless — validity derives
// from the protected payload (signature + expiry + binding).
type CsrfService struct {
	protector     *CsrfProtector
	binding       BindingResolver
	lifetime      int
	entropy       int
	now           func() int64
	rotationStore RotationStore
}

// NewCsrfService creates a token service.
func NewCsrfService(protector *CsrfProtector, binding BindingResolver, lifetimeSeconds, entropyBytes int) *CsrfService {
	return &CsrfService{
		protector: protector,
		binding:   binding,
		lifetime:  lifetimeSeconds,
		entropy:   entropyBytes,
		now:       func() int64 { return time.Now().Unix() },
	}
}

// IssueToken issues a new token bound to the given source/kind.
func (s *CsrfService) IssueToken(bindingSource, bindingKind string) (string, error) {
	fingerprint := core.CsrfBindingFingerprint(bindingSource, core.CsrfBindingKind(bindingKind))
	issuedAt := s.now()
	randomBytes := make([]byte, s.entropy)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", err
	}
	randomPart := base64.RawURLEncoding.EncodeToString(randomBytes)
	payload, err := core.EncodeCsrfPayload(issuedAt, randomPart, fingerprint)
	if err != nil {
		return "", err
	}
	return s.protector.Protect(payload)
}

// ValidateToken validates a wire token against the expected fingerprint.
// Outcome ordering: signature → decode → binding → expiry.
func (s *CsrfService) ValidateToken(token string, expectedFingerprint string) CsrfValidationResult {
	if token == "" {
		return CsrfValidationResult{Outcome: OutcomeMissingToken}
	}
	plaintext := s.protector.Unprotect(token)
	if plaintext == "" {
		return CsrfValidationResult{Outcome: OutcomeInvalidSignature}
	}
	parts, ok := core.TryDecodeCsrfPayload(plaintext)
	if !ok {
		return CsrfValidationResult{Outcome: OutcomeMalformedPayload}
	}
	if parts.BindingFingerprint != expectedFingerprint {
		return CsrfValidationResult{Outcome: OutcomeBindingMismatch}
	}
	if rotated := s.checkRotation(parts.BindingFingerprint, parts.IssuedAtUnixSeconds); rotated != "" {
		return CsrfValidationResult{Outcome: rotated, BindingFingerprint: parts.BindingFingerprint}
	}
	age := s.now() - parts.IssuedAtUnixSeconds
	if age > int64(s.lifetime) {
		return CsrfValidationResult{Outcome: OutcomeExpired}
	}
	return CsrfValidationResult{Outcome: OutcomeValid, BindingFingerprint: parts.BindingFingerprint}
}

// MarshalJSON is used by tests to inspect key rings.
func (r *CsrfKeyRing) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{
		"activeKeyId": r.ActiveKeyID,
		"keyCount":    len(r.Keys),
	})
}
