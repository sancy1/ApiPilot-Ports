package httpapi_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/apipilot/go/core"
	"github.com/apipilot/go/httpapi"
)

// --- Rotation store -------------------------------------------------------

func TestInMemoryRotationStore(t *testing.T) {
	store := httpapi.NewInMemoryRotationStore()
	if _, ok := store.GetRotationMarker("b1"); ok {
		t.Fatal("expected no marker initially")
	}
	store.SetRotationMarker("b1", 1234)
	if v, ok := store.GetRotationMarker("b1"); !ok || v != 1234 {
		t.Fatalf("marker = %d, %v", v, ok)
	}
	store.ClearRotationMarker("b1")
	if _, ok := store.GetRotationMarker("b1"); ok {
		t.Fatal("expected marker cleared")
	}
}

func newTestService(t *testing.T) (*httpapi.CsrfService, *httpapi.InMemoryRotationStore) {
	t.Helper()
	ring := testKeyRing(t)
	protector, err := httpapi.NewCsrfProtector(ring)
	if err != nil {
		t.Fatalf("protector: %v", err)
	}
	binding := &httpapi.DefaultBindingResolver{
		PreAuthSource: func(r *http.Request) string { return "client-1" },
	}
	store := httpapi.NewInMemoryRotationStore()
	svc := httpapi.NewCsrfService(protector, binding, 7200, 32).
		WithRotationStore(store)
	return svc, store
}

func TestRotationRejectsPreMarkerToken(t *testing.T) {
	svc, store := newTestService(t)
	token, err := svc.IssueToken("client-1", "preauth")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	fp := core.CsrfBindingFingerprint("client-1", core.BindingPreAuth)

	// Baseline: valid before any marker.
	if res := svc.ValidateToken(token, fp); res.Outcome != httpapi.OutcomeValid {
		t.Fatalf("baseline outcome = %s", res.Outcome)
	}

	// Marker in the future → token predates rotation → rotated.
	store.SetRotationMarker(fp, time.Now().Unix()+3600)
	if res := svc.ValidateToken(token, fp); res.Outcome != httpapi.OutcomeRotated {
		t.Fatalf("rotated outcome = %s", res.Outcome)
	}

	// Clear marker → valid again.
	store.ClearRotationMarker(fp)
	if res := svc.ValidateToken(token, fp); res.Outcome != httpapi.OutcomeValid {
		t.Fatalf("post-clear outcome = %s", res.Outcome)
	}
}

func TestNoStoreMeansNoRotation(t *testing.T) {
	ring := testKeyRing(t)
	protector, _ := httpapi.NewCsrfProtector(ring)
	binding := &httpapi.DefaultBindingResolver{
		PreAuthSource: func(r *http.Request) string { return "client-1" },
	}
	svc := httpapi.NewCsrfService(protector, binding, 7200, 32) // no store
	token, _ := svc.IssueToken("client-1", "preauth")
	fp := core.CsrfBindingFingerprint("client-1", core.BindingPreAuth)
	if res := svc.ValidateToken(token, fp); res.Outcome != httpapi.OutcomeValid {
		t.Fatalf("outcome = %s", res.Outcome)
	}
}

// --- Transition listener --------------------------------------------------

func TestTransitionListenerLoginLogout(t *testing.T) {
	svc, store := newTestService(t)
	binding := &httpapi.DefaultBindingResolver{
		PreAuthSource: func(r *http.Request) string { return "client-1" },
	}
	listener := httpapi.NewCsrfTransitionListener(svc, binding, store)

	req := httptest.NewRequest("GET", "/", nil)
	token, err := listener.OnLogin(req)
	if err != nil || token == "" {
		t.Fatalf("onLogin token = %q, err = %v", token, err)
	}

	// No binding → fail closed (empty token, nil error).
	emptyBinding := &httpapi.DefaultBindingResolver{}
	listener2 := httpapi.NewCsrfTransitionListener(svc, emptyBinding, store)
	if tok, _ := listener2.OnLogin(req); tok != "" {
		t.Fatal("expected empty token for unresolvable binding")
	}

	// Logout clears the marker.
	fp := core.CsrfBindingFingerprint("client-1", core.BindingPreAuth)
	store.SetRotationMarker(fp, time.Now().Unix()+3600)
	listener.OnLogout(req)
	if _, ok := store.GetRotationMarker(fp); ok {
		t.Fatal("expected marker cleared on logout")
	}
}

// --- Endpoint policy resolver ----------------------------------------------

func TestResolveEndpointPolicy(t *testing.T) {
	cases := []struct {
		require, skip bool
		want          httpapi.CsrfEndpointPolicy
	}{
		{false, false, httpapi.PolicyUseGlobal},
		{true, false, httpapi.PolicyRequire},
		{false, true, httpapi.PolicySkip},
		{true, true, httpapi.PolicyRequire}, // Require beats Skip
	}
	for _, c := range cases {
		if got := httpapi.ResolveEndpointPolicy(c.require, c.skip); got != c.want {
			t.Fatalf("ResolveEndpointPolicy(%v,%v) = %s, want %s", c.require, c.skip, got, c.want)
		}
	}
}

// --- Observability ----------------------------------------------------------

func TestMetricsCounters(t *testing.T) {
	m := &httpapi.Metrics{}
	m.RecordCsrfIssued()
	m.RecordCsrfValidated()
	m.RecordCsrfRejected()
	m.RecordCsrfExpired()
	m.RecordRateLimited()
	m.RecordValidationFailed()
	m.RecordOriginRejected()
	m.RecordFetchMetadataRejected()
	m.RecordCookieRejected()
	snap := m.Snapshot()
	if snap["csrf.issued"] != 1 || snap["csrf.validated"] != 1 ||
		snap["csrf.rejected"] != 1 || snap["csrf.expired"] != 1 ||
		snap["rate_limited"] != 1 || snap["validation_failed"] != 1 ||
		snap["origin_rejected"] != 1 || snap["fetch_metadata_rejected"] != 1 ||
		snap["cookie_rejected"] != 1 {
		t.Fatalf("snapshot = %v", snap)
	}
}

func TestRedactString(t *testing.T) {
	out := httpapi.RedactString("password=hunter2 token=abc123 Bearer xyz", httpapi.DefaultRedactionPolicy())
	if strings.Contains(out, "hunter2") || strings.Contains(out, "abc123") || strings.Contains(out, "xyz") {
		t.Fatalf("redactString leaked: %q", out)
	}
	if !strings.Contains(out, "[REDACTED]") {
		t.Fatalf("redactString missing marker: %q", out)
	}
}

func TestRedactMap(t *testing.T) {
	in := map[string]any{
		"username": "alice",
		"password": "secret",
		"nested":   map[string]any{"api_key": "k", "ok": "fine"},
	}
	out := httpapi.RedactMap(in, httpapi.DefaultRedactionPolicy())
	m := out
	if m["password"] != "[REDACTED]" {
		t.Fatalf("password not redacted: %v", m["password"])
	}
	if m["username"] != "alice" {
		t.Fatalf("username altered: %v", m["username"])
	}
	nested := m["nested"].(map[string]any)
	if nested["api_key"] != "[REDACTED]" || nested["ok"] != "fine" {
		t.Fatalf("nested redaction wrong: %v", nested)
	}
}
