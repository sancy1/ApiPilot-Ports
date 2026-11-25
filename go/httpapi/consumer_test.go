package httpapi_test

// Consumer CDCT for httpapi — shared consumer app scenarios.
// Mirrors conformance/consumer/README.md.

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/apipilot/go/core"
	"github.com/apipilot/go/httpapi"
)

func consumerOptions() httpapi.Options {
	opts := httpapi.DefaultOptions()
	opts.Csrf.Enabled = true
	opts.Csrf.RotationRequirement = "optional"
	opts.Origin.Enabled = true
	opts.Origin.AllowedOrigins = []string{"https://app.example.com"}
	opts.PaginationEnabled = true
	opts.FetchMetadata.Profile = core.FetchMetadataStrict
	return opts
}

func consumerBinding() *httpapi.DefaultBindingResolver {
	return &httpapi.DefaultBindingResolver{
		SessionExtractor: func(r *http.Request) string {
			return r.Header.Get("X-Session-Id")
		},
	}
}

// consumerHandler is the shared consumer app: identical routes on every port.
func consumerHandler(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/health" && r.Method == http.MethodGet:
		httpapi.SendSuccess(w, httpapi.RequestID(r),
			map[string]string{"status": "ok"}, 0, nil, nil)
	case r.URL.Path == "/items" && r.Method == http.MethodGet:
		parsed, _ := httpapi.Pagination(r)
		httpapi.SendSuccess(w, httpapi.RequestID(r), map[string]any{
			"page":     parsed.PageRequest.Page,
			"pageSize": parsed.PageRequest.PageSize,
		}, 0, nil, nil)
	case r.URL.Path == "/fail" && r.Method == http.MethodGet:
		httpapi.SendError(w, httpapi.RequestID(r), core.ResourceNotFound,
			"Item not found.", 0, nil, nil)
	case r.URL.Path == "/validate" && r.Method == http.MethodGet:
		httpapi.SendValidationError(w, httpapi.RequestID(r),
			map[string][]string{"page": {"must be an integer"}}, "")
	case r.URL.Path == "/echo" && r.Method == http.MethodPost:
		body, _ := io.ReadAll(r.Body)
		httpapi.SendSuccess(w, httpapi.RequestID(r),
			map[string]string{"echo": string(body)}, 0, nil, nil)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func consumerServer(t *testing.T) *httptest.Server {
	t.Helper()
	return newServer(t, consumerOptions(), testKeyRing(t), consumerBinding(), consumerHandler)
}

func do(t *testing.T, srv *httptest.Server, method, path string, headers map[string]string, body string) (int, http.Header, map[string]any) {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var env map[string]any
	_ = json.Unmarshal(raw, &env)
	return resp.StatusCode, resp.Header, env
}

func data(t *testing.T, env map[string]any) map[string]any {
	t.Helper()
	d, _ := env["data"].(map[string]any)
	return d
}

func errObj(t *testing.T, env map[string]any) map[string]any {
	t.Helper()
	e, _ := env["error"].(map[string]any)
	return e
}

func meta(t *testing.T, env map[string]any) map[string]any {
	t.Helper()
	m, _ := env["meta"].(map[string]any)
	return m
}

func TestConsumerS1CorrelationAndSuccessEnvelope(t *testing.T) {
	srv := consumerServer(t)
	defer srv.Close()
	status, hdrs, env := do(t, srv, "GET", "/health", nil, "")
	if status != 200 {
		t.Fatalf("status = %d", status)
	}
	corrID := hdrs.Get("X-Request-Id")
	if corrID == "" {
		t.Fatal("x-request-id header missing")
	}
	if env["success"] != true {
		t.Fatalf("success = %v", env["success"])
	}
	if meta(t, env)["requestId"] != corrID {
		t.Fatalf("meta.requestId = %v, want %v", meta(t, env)["requestId"], corrID)
	}
}

func TestConsumerS2PaginationContext(t *testing.T) {
	srv := consumerServer(t)
	defer srv.Close()
	status, _, env := do(t, srv, "GET", "/items?page=2&pageSize=5", nil, "")
	if status != 200 {
		t.Fatalf("status = %d", status)
	}
	d := data(t, env)
	if d["page"] != float64(2) || d["pageSize"] != float64(5) {
		t.Fatalf("data = %v", d)
	}
}

func TestConsumerS3InvalidPagination(t *testing.T) {
	srv := consumerServer(t)
	defer srv.Close()
	status, _, env := do(t, srv, "GET", "/items?page=abc", nil, "")
	if status != 400 {
		t.Fatalf("status = %d", status)
	}
	if errObj(t, env)["code"] != "VALIDATION_ERROR" {
		t.Fatalf("code = %v", errObj(t, env)["code"])
	}
	fields, _ := errObj(t, env)["fields"].(map[string]any)
	if _, ok := fields["page"]; !ok {
		t.Fatalf("fields.page missing: %v", errObj(t, env))
	}
}

func TestConsumerS4NotFoundEnvelope(t *testing.T) {
	srv := consumerServer(t)
	defer srv.Close()
	status, _, env := do(t, srv, "GET", "/fail", nil, "")
	if status != 404 {
		t.Fatalf("status = %d", status)
	}
	if errObj(t, env)["code"] != "RESOURCE_NOT_FOUND" {
		t.Fatalf("code = %v", errObj(t, env)["code"])
	}
}

func TestConsumerS5DisallowedOrigin(t *testing.T) {
	srv := consumerServer(t)
	defer srv.Close()
	status, _, env := do(t, srv, "POST", "/echo", map[string]string{
		"Origin":         "https://evil.example",
		"Content-Type":   "application/json",
		"X-Session-Id":   "sess-1",
	}, "{}")
	if status != 403 {
		t.Fatalf("status = %d", status)
	}
	if errObj(t, env)["code"] != "CSRF_ORIGIN_REJECTED" {
		t.Fatalf("code = %v", errObj(t, env)["code"])
	}
}

func TestConsumerS6CsrfBootstrapThenPost(t *testing.T) {
	srv := consumerServer(t)
	defer srv.Close()
	session := map[string]string{"X-Session-Id": "sess-cdct"}

	status, _, env := do(t, srv, "GET", "/api/csrf", session, "")
	if status != 200 {
		t.Fatalf("bootstrap status = %d", status)
	}
	token, _ := data(t, env)["token"].(string)
	if token == "" {
		t.Fatal("bootstrap token missing")
	}

	status, _, env = do(t, srv, "POST", "/echo", map[string]string{
		"X-Session-Id": "sess-cdct",
		"Content-Type": "application/json",
		"Origin":       "https://app.example.com",
	}, "{}")
	if status != 403 {
		t.Fatalf("no-token status = %d", status)
	}
	if code, _ := errObj(t, env)["code"].(string); !strings.HasPrefix(code, "CSRF_") {
		t.Fatalf("code = %v", errObj(t, env)["code"])
	}

	hdrs := map[string]string{
		"X-Session-Id":  "sess-cdct",
		"Content-Type":  "application/json",
		"Origin":        "https://app.example.com",
		"X-CSRF-Token":  token,
	}
	status, _, _ = do(t, srv, "POST", "/echo", hdrs, "{}")
	if status != 200 {
		t.Fatalf("with-token status = %d", status)
	}
}

func TestConsumerS7FetchMetadataCrossSite(t *testing.T) {
	srv := consumerServer(t)
	defer srv.Close()
	status, _, _ := do(t, srv, "POST", "/echo", map[string]string{
		"X-Session-Id":   "sess-fm",
		"Content-Type":   "application/json",
		"Origin":         "https://app.example.com",
		"Sec-Fetch-Site": "cross-site",
	}, "{}")
	if status != 403 {
		t.Fatalf("status = %d", status)
	}
}
