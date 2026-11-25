// ApiPilot + Chi example.
//
// The httpapi.Middleware.Wrap signature is func(http.Handler) http.Handler,
// which is exactly Chi's middleware contract — r.Use(mw.Wrap) drops the
// full ApiPilot pipeline (correlation, origin, fetch-metadata, CSRF,
// pagination, exception mapping) into any Chi router.
//
// Run:  go mod tidy && go run .
// Then: curl http://localhost:8080/health
//
//	curl http://localhost:8080/api/csrf -H "X-Session-Id: demo"
package main

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"

	"github.com/sancy1/ApiPilot-Ports/go/httpapi"
	"github.com/go-chi/chi/v5"
)

func main() {
	// Ephemeral dev key ring — production should load from env/secret store.
	key, err := base64.StdEncoding.DecodeString(httpapi.GenerateKeyMaterial())
	if err != nil {
		log.Fatal(err)
	}
	ring := &httpapi.CsrfKeyRing{
		ActiveKeyID: "dev",
		Keys:        map[string][]byte{"dev": key},
	}

	// Bind CSRF tokens to a session header (demo — real apps resolve
	// subject/session from auth state).
	binding := &httpapi.DefaultBindingResolver{
		SessionExtractor: func(r *http.Request) string {
			return r.Header.Get("X-Session-Id")
		},
	}

	opts := httpapi.DefaultOptions()
	opts.Csrf.Enabled = true
	opts.Origin.Enabled = true
	opts.Origin.AllowedOrigins = []string{"http://localhost:8080"}
	opts.PaginationEnabled = true

	mw, err := httpapi.New(opts, ring, binding)
	if err != nil {
		log.Fatal(err)
	}

	r := chi.NewRouter()
	r.Use(mw.Wrap) // <-- the entire ApiPilot pipeline

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	})

	r.Get("/items", func(w http.ResponseWriter, r *http.Request) {
		// Pagination query (?page=&pageSize=) is parsed by the middleware;
		// handlers read it via httpapi.Pagination(r).
		writeJSON(w, http.StatusOK, map[string]any{"items": []string{"a", "b", "c"}})
	})

	r.Post("/items", func(w http.ResponseWriter, r *http.Request) {
		// Unsafe method — requires X-CSRF-Token from GET /api/csrf.
		writeJSON(w, http.StatusCreated, map[string]any{"created": true})
	})

	log.Println("ApiPilot Chi example on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", r))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
