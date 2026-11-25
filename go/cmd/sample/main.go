// Package main — runnable ApiPilot Go sample.
//
// Demonstrates the full middleware pipeline: correlation IDs, content
// negotiation, origin policy, fetch metadata, CSRF (bootstrap + validation),
// rate limiting, and the standard error envelope.
//
// Run:
//
//	cd go && go run ./cmd/sample
//
// Then:
//
//	curl http://localhost:8080/health
//	curl http://localhost:8080/api/csrf            # bootstrap → { token }
//	curl -X POST http://localhost:8080/api/items \
//	     -H "X-Client-Id: demo" -H "X-CSRF-Token: <token>" \
//	     -H "Origin: http://localhost:8080" -H "Content-Type: application/json" \
//	     -d '{"name":"widget"}'
package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/sancy1/ApiPilot-Ports/go/httpapi"
)

func main() {
	opts := httpapi.DefaultOptions()

	// CSRF protection — key material comes from APIPILOT_CSRF_KEYS /
	// APIPILOT_CSRF_ACTIVE_KEY, or generate one for the demo.
	opts.Csrf.Enabled = true

	// Origin policy — only same-origin browser POSTs.
	opts.Origin.Enabled = true
	opts.Origin.AllowedOrigins = []string{"http://localhost:8080"}
	opts.Origin.RequireOriginHeader = true

	// Rate limiting — 60 requests / minute per client.
	opts.RateLimit.Enabled = true
	opts.RateLimit.RequestsPerWindow = 60
	opts.RateLimit.WindowSeconds = 60

	// Binding: pre-auth source from a client header (demo only — real apps
	// should resolve subject/session bindings from auth state).
	binding := &httpapi.DefaultBindingResolver{
		PreAuthSource: func(r *http.Request) string {
			return r.Header.Get("X-Client-Id")
		},
	}

	mw, err := httpapi.New(opts, nil, binding)
	if err != nil {
		log.Fatalf("apipilot: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		httpapi.SendSuccessOpts(w, "demo", map[string]string{"status": "ok"}, http.StatusOK, nil, nil, opts.Json)
	})
	mux.HandleFunc("POST /api/items", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		httpapi.SendSuccessOpts(w, "demo", map[string]any{"created": body}, http.StatusCreated, nil, nil, opts.Json)
	})

	addr := ":8080"
	log.Printf("apipilot sample listening on http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, mw.Wrap(mux)))
}
