package httpapi

// CSRF extras — rotation store, transition listener, endpoint policy resolver.
// Mirrors ICsrfRotationStore, DefaultCsrfTransitionListener,
// CsrfEndpointPolicyResolver (C# ApiPilot.Security).
//
// A rotation marker is the Unix timestamp of the last rotation for a
// binding. A token whose issue time is before the marker is rejected with
// OutcomeRotated. The store is optional; when absent the service operates
// in expiry-only rotation mode.

import (
	"net/http"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Rotation store
// ---------------------------------------------------------------------------

// RotationStore persists rotation markers per binding fingerprint.
// Implementations must be safe for concurrent use.
type RotationStore interface {
	// GetRotationMarker returns the last-rotation Unix timestamp for the
	// binding, or (0, false) when no rotation has been recorded.
	GetRotationMarker(binding string) (int64, bool)
	// SetRotationMarker records a rotation marker for the binding.
	SetRotationMarker(binding string, unixSeconds int64)
	// ClearRotationMarker removes the marker for the binding.
	ClearRotationMarker(binding string)
}

// InMemoryRotationStore is a process-local RotationStore.
type InMemoryRotationStore struct {
	mu      sync.RWMutex
	markers map[string]int64
}

// NewInMemoryRotationStore creates an empty store.
func NewInMemoryRotationStore() *InMemoryRotationStore {
	return &InMemoryRotationStore{markers: map[string]int64{}}
}

// GetRotationMarker implements RotationStore.
func (s *InMemoryRotationStore) GetRotationMarker(binding string) (int64, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.markers[binding]
	return v, ok
}

// SetRotationMarker implements RotationStore.
func (s *InMemoryRotationStore) SetRotationMarker(binding string, unixSeconds int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.markers[binding] = unixSeconds
}

// ClearRotationMarker implements RotationStore.
func (s *InMemoryRotationStore) ClearRotationMarker(binding string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.markers, binding)
}

// ---------------------------------------------------------------------------
// Service rotation wiring
// ---------------------------------------------------------------------------

// WithRotationStore attaches a rotation store to the service. When set,
// tokens issued before the binding's rotation marker validate as
// OutcomeRotated. Returns the service for chaining.
func (s *CsrfService) WithRotationStore(store RotationStore) *CsrfService {
	s.rotationStore = store
	return s
}

// checkRotation returns OutcomeRotated when the token predates the
// binding's rotation marker. Called after binding match, before expiry.
func (s *CsrfService) checkRotation(bindingFingerprint string, issuedAt int64) CsrfValidationOutcome {
	if s.rotationStore == nil {
		return ""
	}
	marker, ok := s.rotationStore.GetRotationMarker(bindingFingerprint)
	if ok && issuedAt < marker {
		return OutcomeRotated
	}
	return ""
}

// MarkRotated records a rotation marker for the binding at the current time.
func (s *CsrfService) MarkRotated(bindingFingerprint string) {
	if s.rotationStore != nil {
		s.rotationStore.SetRotationMarker(bindingFingerprint, s.now())
	}
}

// ---------------------------------------------------------------------------
// Transition listener
// ---------------------------------------------------------------------------

// CsrfTransitionListener issues fresh tokens on login and clears rotation
// markers on logout. It never authenticates users or writes cookies — the
// application owns its session lifecycle.
type CsrfTransitionListener struct {
	service  *CsrfService
	resolver BindingResolver
	store    RotationStore // may be nil
	now      func() time.Time
}

// NewCsrfTransitionListener creates a listener over the service, binding
// resolver, and optional rotation store.
func NewCsrfTransitionListener(service *CsrfService, resolver BindingResolver, store RotationStore) *CsrfTransitionListener {
	return &CsrfTransitionListener{
		service:  service,
		resolver: resolver,
		store:    store,
		now:      time.Now,
	}
}

// OnLogin resolves the binding for the request and issues a fresh token.
// Returns ("", nil) when no binding can be resolved — fail closed.
func (l *CsrfTransitionListener) OnLogin(r *http.Request) (string, error) {
	binding := l.resolver.Resolve(r)
	if binding == nil {
		return "", nil
	}
	return l.service.IssueToken(binding.Source, binding.Kind)
}

// OnLoginWithBinding issues a fresh token for an explicit binding
// fingerprint's source. Used when the caller already knows the new binding.
func (l *CsrfTransitionListener) OnLoginWithBinding(source, kind string) (string, error) {
	return l.service.IssueToken(source, kind)
}

// OnLogout clears the rotation marker for the request's binding when a
// store is registered. Safe to call before or after session teardown.
func (l *CsrfTransitionListener) OnLogout(r *http.Request) {
	if l.store == nil {
		return
	}
	binding := l.resolver.Resolve(r)
	if binding != nil {
		l.store.ClearRotationMarker(binding.Fingerprint)
	}
}

// OnLogoutWithFingerprint clears the rotation marker for an explicit
// binding fingerprint.
func (l *CsrfTransitionListener) OnLogoutWithFingerprint(fingerprint string) {
	if l.store != nil && fingerprint != "" {
		l.store.ClearRotationMarker(fingerprint)
	}
}

// ---------------------------------------------------------------------------
// Endpoint policy resolver
// ---------------------------------------------------------------------------

// CsrfEndpointPolicy is the effective per-endpoint policy.
type CsrfEndpointPolicy string

const (
	PolicyUseGlobal CsrfEndpointPolicy = "useGlobal"
	PolicyRequire   CsrfEndpointPolicy = "require"
	PolicySkip      CsrfEndpointPolicy = "skip"
)

// ResolveEndpointPolicy combines per-route flags into the effective policy.
// Precedence: Require > Skip > UseGlobal — mirrors CsrfEndpointPolicyResolver.
// Later flags do not override earlier ones of higher precedence.
func ResolveEndpointPolicy(require, skip bool) CsrfEndpointPolicy {
	if require {
		return PolicyRequire
	}
	if skip {
		return PolicySkip
	}
	return PolicyUseGlobal
}
