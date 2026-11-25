package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sancy1/ApiPilot-Ports/go/core"
	"github.com/sancy1/ApiPilot-Ports/go/httpapi"
)

func testKeyRing(t *testing.T) *httpapi.CsrfKeyRing {
	t.Helper()
	return &httpapi.CsrfKeyRing{
		ActiveKeyID: "k1",
		Keys: map[string][]byte{
			"k1": make([]byte, 32), // AES-256 key material
		},
	}
}

func sessionBinding() *httpapi.DefaultBindingResolver {
	return &httpapi.DefaultBindingResolver{
		SessionExtractor: func(r *http.Request) string {
			if c, err := r.Cookie("session"); err == nil {
				return c.Value
			}
			return ""
		},
	}
}

func newServer(t *testing.T, opts httpapi.Options, ring *httpapi.CsrfKeyRing, binding httpapi.BindingResolver, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	mw, err := httpapi.New(opts, ring, binding)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return httptest.NewServer(mw.Wrap(handler))
}

func decodeEnvelope(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	var env map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	return env
}

func TestSuccessEnvelope(t *testing.T) {
	opts := httpapi.DefaultOptions()
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), map[string]string{"ok": "yes"}, 0, nil, nil)
	})
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/items")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	env := decodeEnvelope(t, resp)
	if env["success"] != true {
		t.Fatalf("success = %v", env["success"])
	}
	data := env["data"].(map[string]any)
	if data["ok"] != "yes" {
		t.Fatalf("data = %v", data)
	}
	meta := env["meta"].(map[string]any)
	if meta["requestId"] == "" {
		t.Fatal("meta.requestId empty")
	}
	// Correlation echo header.
	if resp.Header.Get("X-Request-Id") == "" {
		t.Fatal("X-Request-Id response header missing")
	}
}

func TestCorrelationIncoming(t *testing.T) {
	opts := httpapi.DefaultOptions()
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL, nil)
	req.Header.Set("X-Request-Id", "req-abc-12345")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if got := resp.Header.Get("X-Request-Id"); got != "req-abc-12345" {
		t.Fatalf("echoed id = %q", got)
	}
}

func TestContentNegotiation406(t *testing.T) {
	opts := httpapi.DefaultOptions()
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL, nil)
	req.Header.Set("Accept", "text/html")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 406 {
		t.Fatalf("status = %d, want 406", resp.StatusCode)
	}
	env := decodeEnvelope(t, resp)
	errObj := env["error"].(map[string]any)
	if errObj["code"] != "NOT_ACCEPTABLE" {
		t.Fatalf("code = %v", errObj["code"])
	}
}

func TestContentNegotiation415(t *testing.T) {
	opts := httpapi.DefaultOptions()
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	req, _ := http.NewRequest("POST", srv.URL, strings.NewReader("{}"))
	req.Header.Set("Content-Type", "text/plain")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 415 {
		t.Fatalf("status = %d, want 415", resp.StatusCode)
	}
}

func TestOriginPolicy(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.Origin = httpapi.OriginPolicyOptions{
		Enabled:              true,
		AllowedOrigins:       []string{"https://app.example.com"},
		MatchMode:            "exact",
		RequireOriginHeader:  true,
		AllowRefererFallback: true,
	}
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	// Allowed origin.
	req, _ := http.NewRequest("POST", srv.URL, strings.NewReader("{}"))
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("allowed origin status = %d", resp.StatusCode)
	}

	// Rejected origin.
	req2, _ := http.NewRequest("POST", srv.URL, strings.NewReader("{}"))
	req2.Header.Set("Origin", "https://evil.example.com")
	req2.Header.Set("Content-Type", "application/json")
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != 403 {
		t.Fatalf("rejected origin status = %d, want 403", resp2.StatusCode)
	}
	resp2.Body.Close()
}

func TestCSRFBootstrapAndValidation(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.Csrf = httpapi.CsrfOptions{
		Enabled:              true,
		HeaderName:           "X-CSRF-Token",
		BootstrapPath:        "/api/csrf",
		TokenLifetimeSeconds: 7200,
		TokenEntropyBytes:    32,
		ProtectedMethods:     []string{"POST", "PUT", "PATCH", "DELETE"},
	}
	srv := newServer(t, opts, testKeyRing(t), sessionBinding(), func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), map[string]string{"done": "ok"}, 0, nil, nil)
	})
	defer srv.Close()

	// Bootstrap: GET /api/csrf with session cookie.
	req, _ := http.NewRequest("GET", srv.URL+"/api/csrf", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: "sess-123"})
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("bootstrap status = %d", resp.StatusCode)
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("Cache-Control: no-store missing")
	}
	env := decodeEnvelope(t, resp)
	data := env["data"].(map[string]any)
	token, ok := data["token"].(string)
	if !ok || token == "" {
		t.Fatalf("token missing: %v", data)
	}

	// POST without token → 403 CSRF_HEADER_MISSING.
	req2, _ := http.NewRequest("POST", srv.URL+"/items", strings.NewReader("{}"))
	req2.Header.Set("Content-Type", "application/json")
	req2.AddCookie(&http.Cookie{Name: "session", Value: "sess-123"})
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != 403 {
		t.Fatalf("missing token status = %d, want 403", resp2.StatusCode)
	}
	env2 := decodeEnvelope(t, resp2)
	if env2["error"].(map[string]any)["code"] != "CSRF_HEADER_MISSING" {
		t.Fatalf("code = %v", env2["error"])
	}

	// POST with valid token → 200.
	req3, _ := http.NewRequest("POST", srv.URL+"/items", strings.NewReader("{}"))
	req3.Header.Set("Content-Type", "application/json")
	req3.Header.Set("X-CSRF-Token", token)
	req3.AddCookie(&http.Cookie{Name: "session", Value: "sess-123"})
	resp3, err := http.DefaultClient.Do(req3)
	if err != nil {
		t.Fatal(err)
	}
	if resp3.StatusCode != 200 {
		t.Fatalf("valid token status = %d", resp3.StatusCode)
	}
	resp3.Body.Close()

	// POST with token bound to different session → 403 CSRF_TOKEN_INVALID.
	req4, _ := http.NewRequest("POST", srv.URL+"/items", strings.NewReader("{}"))
	req4.Header.Set("Content-Type", "application/json")
	req4.Header.Set("X-CSRF-Token", token)
	req4.AddCookie(&http.Cookie{Name: "session", Value: "sess-OTHER"})
	resp4, err := http.DefaultClient.Do(req4)
	if err != nil {
		t.Fatal(err)
	}
	if resp4.StatusCode != 403 {
		t.Fatalf("binding mismatch status = %d, want 403", resp4.StatusCode)
	}
	resp4.Body.Close()
}

func TestExceptionMapping(t *testing.T) {
	opts := httpapi.DefaultOptions()
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	})
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/boom")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 500 {
		t.Fatalf("status = %d, want 500", resp.StatusCode)
	}
	env := decodeEnvelope(t, resp)
	errObj := env["error"].(map[string]any)
	if errObj["code"] != "INTERNAL_ERROR" {
		t.Fatalf("code = %v", errObj["code"])
	}
	// Message hidden by default.
	if errObj["message"] != "An unexpected error occurred." {
		t.Fatalf("message = %v", errObj["message"])
	}
}

func TestPaginationContext(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.PaginationEnabled = true
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		p, ok := httpapi.Pagination(r)
		if !ok {
			http.Error(w, "no pagination", 500)
			return
		}
		httpapi.SendPaginated(w, httpapi.RequestID(r), []string{"a", "b"},
			core.BuildPagination(2, p.PageRequest.Page, p.PageRequest.PageSize), 0, nil)
	})
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/items?page=1&pageSize=10")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	env := decodeEnvelope(t, resp)
	pag := env["pagination"].(map[string]any)
	if pag["page"] != float64(1) || pag["pageSize"] != float64(10) {
		t.Fatalf("pagination = %v", pag)
	}
	if pag["totalItems"] != float64(2) {
		t.Fatalf("totalItems = %v", pag["totalItems"])
	}
}

func TestPaginationValidationError(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.PaginationEnabled = true
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/items?pageSize=500")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	env := decodeEnvelope(t, resp)
	if env["error"].(map[string]any)["code"] != "VALIDATION_ERROR" {
		t.Fatalf("code = %v", env["error"])
	}
}

// ---------------------------------------------------------------------------
// Expanded integration scenarios (mirroring C# integration tests)
// ---------------------------------------------------------------------------

func TestCorrelationRejectPolicy(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.Correlation.InvalidIDPolicy = core.InvalidIDReject
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL, nil)
	req.Header.Set("X-Request-Id", "bad id with spaces!")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	env := decodeEnvelope(t, resp)
	if env["error"].(map[string]any)["code"] != "VALIDATION_ERROR" {
		t.Fatalf("code = %v", env["error"])
	}
}

func TestCorrelationGeneratedIsGUIDv7(t *testing.T) {
	opts := httpapi.DefaultOptions()
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	id := resp.Header.Get("X-Request-Id")
	if len(id) != 36 || id[14] != '7' {
		t.Fatalf("generated id not GUIDv7: %q", id)
	}
}

func TestCorrelationCustomHeaderName(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.Correlation.HeaderName = "X-Correlation-Id"
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL, nil)
	req.Header.Set("X-Correlation-Id", "corr-12345")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if got := resp.Header.Get("X-Correlation-Id"); got != "corr-12345" {
		t.Fatalf("echoed = %q", got)
	}
	// Default header should NOT be echoed.
	if got := resp.Header.Get("X-Request-Id"); got != "" {
		t.Fatalf("default header should not be set: %q", got)
	}
}

func TestContentNegotiationMissingContentTypeMessage(t *testing.T) {
	opts := httpapi.DefaultOptions()
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	// POST with NO Content-Type at all → 415 with "required" message.
	req, _ := http.NewRequest("POST", srv.URL, strings.NewReader("{}"))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 415 {
		t.Fatalf("status = %d, want 415", resp.StatusCode)
	}
	env := decodeEnvelope(t, resp)
	msg := env["error"].(map[string]any)["message"].(string)
	if !strings.Contains(msg, "required") {
		t.Fatalf("message = %q", msg)
	}
}

func TestContentNegotiationAcceptWildcard(t *testing.T) {
	opts := httpapi.DefaultOptions()
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL, nil)
	req.Header.Set("Accept", "*/*")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("wildcard accept should pass: %d", resp.StatusCode)
	}
}

func TestOriginMissingHeaderRejected(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.Origin = httpapi.OriginPolicyOptions{
		Enabled: true, AllowedOrigins: []string{"https://app.example.com"},
		MatchMode: "exact", RequireOriginHeader: true, AllowRefererFallback: true,
	}
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	// POST with no Origin and no Referer → 403.
	req, _ := http.NewRequest("POST", srv.URL, strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Fatalf("missing origin status = %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestOriginRefererFallback(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.Origin = httpapi.OriginPolicyOptions{
		Enabled: true, AllowedOrigins: []string{"https://app.example.com"},
		MatchMode: "exact", RequireOriginHeader: true, AllowRefererFallback: true,
	}
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	// No Origin, but Referer from allowed origin → pass.
	req, _ := http.NewRequest("POST", srv.URL, strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Referer", "https://app.example.com/some/page")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("referer fallback status = %d, want 200", resp.StatusCode)
	}
}

func TestOriginSafeMethodSkips(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.Origin = httpapi.OriginPolicyOptions{
		Enabled: true, AllowedOrigins: []string{"https://app.example.com"},
		MatchMode: "exact", RequireOriginHeader: true,
	}
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	// GET with evil origin → still passes (safe method).
	req, _ := http.NewRequest("GET", srv.URL, nil)
	req.Header.Set("Origin", "https://evil.com")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("safe method should skip origin: %d", resp.StatusCode)
	}
}

func TestFetchMetadataStrictRejects(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.FetchMetadata.Profile = core.FetchMetadataStrict
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	req, _ := http.NewRequest("POST", srv.URL, strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Fatalf("cross-site status = %d, want 403", resp.StatusCode)
	}
	env := decodeEnvelope(t, resp)
	if env["error"].(map[string]any)["code"] != "CSRF_ORIGIN_REJECTED" {
		t.Fatalf("code = %v", env["error"])
	}
	resp.Body.Close()
}

func TestFetchMetadataStrictAllowsSameOrigin(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.FetchMetadata.Profile = core.FetchMetadataStrict
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	req, _ := http.NewRequest("POST", srv.URL, strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("same-origin status = %d, want 200", resp.StatusCode)
	}
}

func csrfTestServer(t *testing.T, opts httpapi.Options, binding httpapi.BindingResolver) *httptest.Server {
	t.Helper()
	return newServer(t, opts, testKeyRing(t), binding, func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccess(w, httpapi.RequestID(r), map[string]string{"ok": "1"}, 0, nil, nil)
	})
}

func csrfEnabledOptions() httpapi.Options {
	opts := httpapi.DefaultOptions()
	opts.Csrf = httpapi.CsrfOptions{
		Enabled: true, HeaderName: "X-CSRF-Token", BootstrapPath: "/api/csrf",
		TokenLifetimeSeconds: 7200, TokenEntropyBytes: 32,
		ProtectedMethods: []string{"POST", "PUT", "PATCH", "DELETE"},
	}
	return opts
}

func TestCSRFSafeMethodSkips(t *testing.T) {
	srv := csrfTestServer(t, csrfEnabledOptions(), sessionBinding())
	defer srv.Close()

	// GET without token → 200.
	resp, err := http.Get(srv.URL + "/items")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("GET should skip CSRF: %d", resp.StatusCode)
	}
}

func TestCSRFTamperedTokenRejected(t *testing.T) {
	srv := csrfTestServer(t, csrfEnabledOptions(), sessionBinding())
	defer srv.Close()

	// Bootstrap to get a valid token.
	req, _ := http.NewRequest("GET", srv.URL+"/api/csrf", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: "s1"})
	resp, _ := http.DefaultClient.Do(req)
	env := decodeEnvelope(t, resp)
	token := env["data"].(map[string]any)["token"].(string)

	// Tamper: flip a character in the ciphertext segment.
	tampered := token[:len(token)-5] + "X" + token[len(token)-4:]
	req2, _ := http.NewRequest("POST", srv.URL+"/items", strings.NewReader("{}"))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-CSRF-Token", tampered)
	req2.AddCookie(&http.Cookie{Name: "session", Value: "s1"})
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != 403 {
		t.Fatalf("tampered token status = %d, want 403", resp2.StatusCode)
	}
	env2 := decodeEnvelope(t, resp2)
	if env2["error"].(map[string]any)["code"] != "CSRF_TOKEN_INVALID" {
		t.Fatalf("code = %v", env2["error"])
	}
}

func TestCSRFBootstrapPathExemptOnPost(t *testing.T) {
	srv := csrfTestServer(t, csrfEnabledOptions(), sessionBinding())
	defer srv.Close()

	// POST to bootstrap path: middleware must not enforce CSRF.
	// (No POST handler mapped → 404/405, but NOT 403.)
	req, _ := http.NewRequest("POST", srv.URL+"/api/csrf", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode == 403 {
		t.Fatal("bootstrap path must be CSRF-exempt")
	}
}

func TestCSRFCustomHeaderName(t *testing.T) {
	opts := csrfEnabledOptions()
	opts.Csrf.HeaderName = "X-XSRF-TOKEN"
	srv := csrfTestServer(t, opts, sessionBinding())
	defer srv.Close()

	// Bootstrap.
	req, _ := http.NewRequest("GET", srv.URL+"/api/csrf", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: "s1"})
	resp, _ := http.DefaultClient.Do(req)
	env := decodeEnvelope(t, resp)
	token := env["data"].(map[string]any)["token"].(string)

	// POST with custom header → 200.
	req2, _ := http.NewRequest("POST", srv.URL+"/items", strings.NewReader("{}"))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-XSRF-TOKEN", token)
	req2.AddCookie(&http.Cookie{Name: "session", Value: "s1"})
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	resp2.Body.Close()
	if resp2.StatusCode != 200 {
		t.Fatalf("custom header status = %d, want 200", resp2.StatusCode)
	}
}

func TestCSRFCustomProtectedMethods(t *testing.T) {
	opts := csrfEnabledOptions()
	opts.Csrf.ProtectedMethods = []string{"DELETE"} // only DELETE protected
	srv := csrfTestServer(t, opts, sessionBinding())
	defer srv.Close()

	// POST without token → passes (not in protected methods).
	req, _ := http.NewRequest("POST", srv.URL+"/items", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("POST should not be protected: %d", resp.StatusCode)
	}

	// DELETE without token → 403.
	req2, _ := http.NewRequest("DELETE", srv.URL+"/items/1", nil)
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != 403 {
		t.Fatalf("DELETE should be protected: %d", resp2.StatusCode)
	}
	resp2.Body.Close()
}

func TestCSRFPreAuthBinding(t *testing.T) {
	opts := csrfEnabledOptions()
	binding := &httpapi.DefaultBindingResolver{
		PreAuthSource: func(r *http.Request) string { return "preauth-fixed" },
	}
	srv := csrfTestServer(t, opts, binding)
	defer srv.Close()

	// Bootstrap (no session needed — preauth binding).
	resp, err := http.Get(srv.URL + "/api/csrf")
	if err != nil {
		t.Fatal(err)
	}
	env := decodeEnvelope(t, resp)
	token := env["data"].(map[string]any)["token"].(string)

	// POST with token → 200.
	req, _ := http.NewRequest("POST", srv.URL+"/items", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", token)
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp2.Body.Close()
	if resp2.StatusCode != 200 {
		t.Fatalf("preauth binding status = %d", resp2.StatusCode)
	}
}

func TestCSRFNoBindingRejects(t *testing.T) {
	opts := csrfEnabledOptions()
	// Resolver with no extractors → always nil binding.
	binding := &httpapi.DefaultBindingResolver{}
	srv := csrfTestServer(t, opts, binding)
	defer srv.Close()

	// Bootstrap → 403 (cannot issue without binding).
	resp, err := http.Get(srv.URL + "/api/csrf")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Fatalf("bootstrap without binding = %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestExceptionCustomMapper(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.ExceptionMappers = []httpapi.ExceptionMapper{
		func(err error) (string, string, bool) {
			if err.Error() == "quota exceeded" {
				return "QUOTA_EXCEEDED", "Quota exceeded.", true
			}
			return "", "", false
		},
	}
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		panic("quota exceeded")
	})
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 500 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	env := decodeEnvelope(t, resp)
	if env["error"].(map[string]any)["code"] != "QUOTA_EXCEEDED" {
		t.Fatalf("code = %v", env["error"])
	}
}

func TestExceptionRevealMessage(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.Exceptions.RevealExceptionMessage = true
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		panic("sensitive detail")
	})
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	env := decodeEnvelope(t, resp)
	if env["error"].(map[string]any)["message"] != "sensitive detail" {
		t.Fatalf("message = %v", env["error"])
	}
}

type statusError struct {
	code int
	msg  string
}

func (e *statusError) Error() string   { return e.msg }
func (e *statusError) StatusCode() int { return e.code }

func TestExceptionHTTPStatusMapping(t *testing.T) {
	opts := httpapi.DefaultOptions()
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		panic(&statusError{code: 404, msg: "gone"})
	})
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
	env := decodeEnvelope(t, resp)
	if env["error"].(map[string]any)["code"] != "RESOURCE_NOT_FOUND" {
		t.Fatalf("code = %v", env["error"])
	}
}

func TestPaginationSortAndFilter(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.PaginationEnabled = true
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		p, _ := httpapi.Pagination(r)
		if p.Sort == nil || p.Sort.Field != "name" || p.Sort.Direction != "desc" {
			http.Error(w, "bad sort", 500)
			return
		}
		if p.Filter == nil || p.Filter.Parameters["status"] != "active" {
			http.Error(w, "bad filter", 500)
			return
		}
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/items?sort=name&direction=desc&status=active")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestPaginationCustomParameterNames(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.PaginationEnabled = true
	opts.Pagination.ParameterNames = core.PaginationParameterNames{
		Page: "p", PageSize: "ps", Sort: "s", Direction: "d",
	}
	srv := newServer(t, opts, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		p, _ := httpapi.Pagination(r)
		if p.PageRequest.Page != 3 || p.PageRequest.PageSize != 10 {
			http.Error(w, "bad page", 500)
			return
		}
		httpapi.SendSuccess(w, httpapi.RequestID(r), nil, 0, nil, nil)
	})
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/items?p=3&ps=10")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestCorrelationIDInErrorEnvelope(t *testing.T) {
	// CSRF failure envelope must carry the incoming correlation ID.
	opts := csrfEnabledOptions()
	srv := csrfTestServer(t, opts, sessionBinding())
	defer srv.Close()

	req, _ := http.NewRequest("POST", srv.URL+"/items", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-Id", "corr-fixed-123")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	env := decodeEnvelope(t, resp)
	meta := env["meta"].(map[string]any)
	if meta["requestId"] != "corr-fixed-123" {
		t.Fatalf("requestId = %v", meta["requestId"])
	}
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

func TestRateLimitAllowsUpToLimit(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.RateLimit = httpapi.RateLimitOptions{Enabled: true, RequestsPerWindow: 2, WindowSeconds: 60, EmitRetryAfter: true}
	mw, err := httpapi.New(opts, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(mw.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	defer srv.Close()

	for i := 0; i < 2; i++ {
		resp, err := http.Get(srv.URL + "/ping")
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("request %d: status %d", i, resp.StatusCode)
		}
	}

	resp, err := http.Get(srv.URL + "/ping")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if resp.Header.Get("Retry-After") == "" {
		t.Fatal("Retry-After header missing")
	}
	env := decodeEnvelope(t, resp)
	errObj := env["error"].(map[string]any)
	if errObj["code"] != "RATE_LIMITED" {
		t.Fatalf("code = %v", errObj["code"])
	}
	if errObj["message"] != "Too many requests. Retry later." {
		t.Fatalf("message = %v", errObj["message"])
	}
}

func TestRateLimitDisabledByDefault(t *testing.T) {
	mw, err := httpapi.New(httpapi.DefaultOptions(), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(mw.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	defer srv.Close()
	for i := 0; i < 10; i++ {
		resp, err := http.Get(srv.URL + "/ping")
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("request %d: status %d", i, resp.StatusCode)
		}
	}
}

func TestRateLimitCustomKeyExtractor(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.RateLimit = httpapi.RateLimitOptions{
		Enabled: true, RequestsPerWindow: 1, WindowSeconds: 60,
		KeyExtractor: func(r *http.Request) string { return r.Header.Get("X-User") },
	}
	mw, err := httpapi.New(opts, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(mw.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	defer srv.Close()

	// Different users get independent windows.
	for _, user := range []string{"alice", "bob"} {
		req, _ := http.NewRequest("GET", srv.URL+"/ping", nil)
		req.Header.Set("X-User", user)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("user %s: status %d", user, resp.StatusCode)
		}
	}

	// Same user second request ? 429.
	req, _ := http.NewRequest("GET", srv.URL+"/ping", nil)
	req.Header.Set("X-User", "alice")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestRateLimitCustomMessageAndNoRetryAfter(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.RateLimit = httpapi.RateLimitOptions{
		Enabled: true, RequestsPerWindow: 1, WindowSeconds: 60,
		Message: "Slow down.", EmitRetryAfter: false,
	}
	mw, err := httpapi.New(opts, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(mw.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	defer srv.Close()

	http.Get(srv.URL + "/ping")
	resp, err := http.Get(srv.URL + "/ping")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	env := decodeEnvelope(t, resp)
	errObj := env["error"].(map[string]any)
	if errObj["message"] != "Slow down." {
		t.Fatalf("message = %v", errObj["message"])
	}
	if resp.Header.Get("Retry-After") != "" {
		t.Fatal("Retry-After should be suppressed")
	}
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

func TestDiagnosticsCsrfNoBinding(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.Csrf.Enabled = true
	diags := httpapi.Diagnostics(opts, &httpapi.DefaultBindingResolver{})
	found := false
	for _, d := range diags {
		if d.Code == "csrf-no-binding" && d.Level == "warning" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected csrf-no-binding warning, got %+v", diags)
	}
}

func TestDiagnosticsCsrfBindingConfigured(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.Csrf.Enabled = true
	binding := &httpapi.DefaultBindingResolver{SubjectExtractor: func(r *http.Request) string { return "u" }}
	diags := httpapi.Diagnostics(opts, binding)
	for _, d := range diags {
		if d.Code == "csrf-no-binding" {
			t.Fatalf("unexpected csrf-no-binding: %+v", diags)
		}
	}
}

func TestDiagnosticsOriginEmptyAllowlist(t *testing.T) {
	opts := httpapi.DefaultOptions()
	opts.Origin.Enabled = true
	diags := httpapi.Diagnostics(opts, nil)
	found := false
	for _, d := range diags {
		if d.Code == "origin-empty-allowlist" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected origin-empty-allowlist, got %+v", diags)
	}
}

func TestDiagnosticsCleanConfig(t *testing.T) {
	diags := httpapi.Diagnostics(httpapi.DefaultOptions(), nil)
	if len(diags) != 0 {
		t.Fatalf("expected no diagnostics, got %+v", diags)
	}
}

// ---------------------------------------------------------------------------
// OpenAPI error schemas
// ---------------------------------------------------------------------------

func TestErrorSchemasShape(t *testing.T) {
	schemas := httpapi.ErrorSchemas()
	if len(schemas) != 3 {
		t.Fatalf("expected 3 schemas, got %d", len(schemas))
	}
	env := schemas[httpapi.ErrorEnvelopeSchemaName]
	props := env["properties"].(map[string]any)
	if props["success"].(map[string]any)["enum"].([]any)[0] != false {
		t.Fatal("success enum must be [false]")
	}
	required := env["required"].([]any)
	if len(required) != 2 {
		t.Fatalf("required = %v", required)
	}

	obj := schemas[httpapi.ErrorObjectSchemaName]
	objProps := obj["properties"].(map[string]any)
	if _, ok := objProps["fields"]; !ok {
		t.Fatal("error object must have fields property")
	}

	fields := schemas[httpapi.ErrorFieldsSchemaName]
	addProps := fields["additionalProperties"].(map[string]any)
	if addProps["type"] != "array" {
		t.Fatalf("additionalProperties.type = %v", addProps["type"])
	}
}


func TestCookieProfileValidationFailsFast(t *testing.T) {
        opts := httpapi.DefaultOptions()
        opts.Cookies.Auth.Secure = false
        opts.Cookies.Auth.SameSite = core.SameSiteNone
        if _, err := httpapi.New(opts, nil, nil); err == nil {
                t.Fatal("expected error for invalid cookie profile")
        }
}
