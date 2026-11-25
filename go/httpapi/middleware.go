package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/sancy1/ApiPilot-Ports/go/core"
)

// Middleware implements the ApiPilot request pipeline as net/http middleware.
// Pipeline order mirrors the C#/TS/Python adapters:
//
//	correlation → content-negotiation → origin → fetch-metadata →
//	CSRF bootstrap → CSRF validation → pagination → next handler →
//	exception mapping (panic recovery).
type Middleware struct {
	opts          Options
	csrf          *CsrfService
	csrfBind      BindingResolver
	csrfProtector *CsrfProtector
	rateLimiter   *RateLimiter
}

type ctxKey int

const (
	ctxRequestID ctxKey = iota
	ctxPagination
)

// New creates a Middleware. When opts.Csrf.Enabled is true, a key ring must be
// provided (or KeyRingFromEnv is used) and a binding resolver (or
// DefaultBindingResolver).
func New(opts Options, keyRing *CsrfKeyRing, binding BindingResolver) (*Middleware, error) {
	// Startup validation — mirrors CookieProfileOptionsValidator (C#):
	// an invalid cookie profile fails fast instead of shipping a weak cookie.
	var violations []string
	for _, entry := range []struct {
		role    core.CookieProfileRole
		profile core.CookieProfile
	}{
		{core.RoleAuth, opts.Cookies.Auth},
		{core.RoleSession, opts.Cookies.Session},
		{core.RoleCSRF, opts.Cookies.Csrf},
	} {
		for _, v := range core.ValidateCookieProfile(entry.profile, entry.role) {
			violations = append(violations, fmt.Sprintf("%s: %s", entry.role, v))
		}
	}
	if len(violations) > 0 {
		return nil, fmt.Errorf("httpapi: invalid cookie profile configuration: %s", strings.Join(violations, ", "))
	}
	m := &Middleware{opts: opts}
	if opts.Csrf.Enabled {
		ring := keyRing
		if ring == nil {
			var err error
			ring, err = KeyRingFromEnv()
			if err != nil {
				return nil, err
			}
		}
		protector, err := NewCsrfProtector(ring)
		if err != nil {
			return nil, err
		}
		if binding == nil {
			binding = &DefaultBindingResolver{}
		}
		if opts.Csrf.RotationRequirement == "required" && opts.Csrf.RotationStore == nil {
			return nil, errors.New("httpapi: csrf.rotationRequirement=required but no RotationStore configured")
		}
		m.csrfProtector = protector
		m.csrfBind = binding
		m.csrf = NewCsrfService(protector, binding, opts.Csrf.TokenLifetimeSeconds, opts.Csrf.TokenEntropyBytes)
		if opts.Csrf.RotationStore != nil {
			m.csrf.WithRotationStore(opts.Csrf.RotationStore)
		}
	}
	if opts.RateLimit.Enabled {
		limit := opts.RateLimit.RequestsPerWindow
		if limit <= 0 {
			limit = 100
		}
		window := time.Duration(opts.RateLimit.WindowSeconds) * time.Second
		if window <= 0 {
			window = time.Minute
		}
		m.rateLimiter = NewRateLimiter(limit, window)
	}
	return m, nil
}

// Wrap returns an http.Handler that runs the ApiPilot pipeline around next.
func (m *Middleware) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m.serveHTTP(w, r, next)
	})
}

// Handler is an alias for Wrap for convenience.
func (m *Middleware) Handler(next http.Handler) http.Handler {
	return m.Wrap(next)
}

func (m *Middleware) serveHTTP(w http.ResponseWriter, r *http.Request, next http.Handler) {
	method := strings.ToUpper(r.Method)

	// Wrap the writer to inject the correlation header and track state.
	cw := &correlationWriter{ResponseWriter: w, headerName: m.opts.Correlation.HeaderName}

	// --- 1. Correlation ---
	requestID, ok := m.resolveCorrelationID(r, cw)
	if !ok {
		return // rejection already sent
	}
	cw.requestID = requestID

	// --- 1b. Rate limiting ---
	if m.rateLimiter != nil {
		keyFn := m.opts.RateLimit.KeyExtractor
		if keyFn == nil {
			keyFn = ClientKey
		}
		if ok, retryAfter := m.rateLimiter.Allow(keyFn(r)); !ok {
			m.metrics().RecordRateLimited()
			message := m.opts.RateLimit.Message
			if message == "" {
				message = "Too many requests. Retry later."
			}
			var headers map[string]string
			if m.opts.RateLimit.EmitRetryAfter && retryAfter > 0 {
				headers = map[string]string{"Retry-After": itoa(retryAfter)}
			}
			SendErrorOpts(cw, requestID, core.RateLimited, message, 0, nil, headers, m.opts.Json)
			return
		}
	}

	// --- 2. Content negotiation ---
	accept := headerPtr(r, "Accept")
	contentType := headerPtr(r, "Content-Type")
	decision := core.EvaluateContentNegotiation(accept, contentType, method, m.opts.ContentNegotiation)
	if decision.Status == core.StatusNotAcceptable {
		SendErrorByCodeOpts(cw, requestID, core.NotAcceptable.Value, "The requested media type is not supported.", 0, m.opts.Json)
		return
	}
	if decision.Status == core.StatusUnsupported {
		message := "The request content type is not supported."
		if contentType == nil || *contentType == "" {
			message = "A Content-Type header is required for this request."
		}
		SendErrorByCodeOpts(cw, requestID, core.UnsupportedMediaType.Value, message, 0, m.opts.Json)
		return
	}

	// --- 3. Origin policy (unsafe methods only) ---
	if !SafeMethods[method] && m.opts.Origin.Enabled {
		if !m.checkOrigin(r, cw, requestID) {
			return
		}
	}

	// --- 4. Fetch metadata (unsafe methods only) ---
	if !SafeMethods[method] && m.opts.FetchMetadata.Profile != core.FetchMetadataOff {
		if !m.checkFetchMetadata(r, cw, requestID) {
			return
		}
	}

	// --- 5. CSRF bootstrap endpoint ---
	if m.csrf != nil && method == "GET" && r.URL.Path == m.opts.Csrf.BootstrapPath {
		m.handleCSRFBootstrap(w, r, cw, requestID)
		return
	}

	// --- 6. CSRF validation (unsafe methods only; bootstrap path exempt) ---
	if m.csrf != nil && !SafeMethods[method] && r.URL.Path != m.opts.Csrf.BootstrapPath && containsFold(m.opts.Csrf.ProtectedMethods, method) {
		if !m.checkCSRF(r, cw, requestID) {
			return
		}
	}

	// --- 7. Pagination (parse + validate; store in context) ---
	ctx := r.Context()
	if m.opts.PaginationEnabled {
		parsed := core.ParsePaginationQuery(queryToMap(r.URL.Query()), m.opts.Pagination)
		if len(parsed.Errors) > 0 {
			m.metrics().RecordValidationFailed()
			SendValidationErrorOpts(cw, requestID, parsed.Errors, "", m.opts.Json)
			return
		}
		ctx = context.WithValue(ctx, ctxPagination, parsed)
	}
	ctx = context.WithValue(ctx, ctxRequestID, requestID)
	r = r.WithContext(ctx)

	// --- 8. Call next with panic recovery ---
	defer func() {
		if rec := recover(); rec != nil {
			m.handleException(cw, requestID, rec)
		}
	}()
	next.ServeHTTP(cw, r)
}

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

// metrics returns the configured Metrics or the shared default.
func (m *Middleware) metrics() *Metrics {
	if m.opts.Metrics != nil {
		return m.opts.Metrics
	}
	return DefaultMetrics
}

func (m *Middleware) resolveCorrelationID(r *http.Request, w http.ResponseWriter) (string, bool) {
	opts := m.opts.Correlation
	headerValue := headerPtr(r, opts.HeaderName)
	patternMatches := false
	if headerValue != nil && opts.ValidationPattern != nil {
		patternMatches = opts.ValidationPattern.MatchString(*headerValue)
	}
	decision := core.ResolveCorrelationID(headerValue, opts, patternMatches)

	switch decision.Kind {
	case core.DecisionReject:
		SendErrorByCodeOpts(w, "", core.ValidationError.Value, "The correlation ID header is invalid.", http.StatusBadRequest, m.opts.Json)
		return "", false
	case core.DecisionUseIncoming:
		return decision.ID, true
	default:
		return core.GenerateGUIDv7(), true
	}
}

func (m *Middleware) checkOrigin(r *http.Request, w http.ResponseWriter, requestID string) bool {
	opts := m.opts.Origin
	candidate := headerPtr(r, "Origin")
	if candidate == nil || *candidate == "" {
		if opts.AllowRefererFallback {
			if ref := headerPtr(r, "Referer"); ref != nil {
				candidate = strPtr(extractOriginFromReferer(*ref))
			}
		}
	}
	if candidate == nil || *candidate == "" {
		if opts.RequireOriginHeader {
			m.metrics().RecordOriginRejected()
			SendErrorByCodeOpts(w, requestID, core.CSRFOriginRejected.Value, "The request origin could not be verified.", 0, m.opts.Json)
			return false
		}
		return true
	}
	for _, allowed := range opts.AllowedOrigins {
		if core.OriginMatches(*candidate, allowed, opts.MatchMode) {
			return true
		}
	}
	m.metrics().RecordOriginRejected()
	SendErrorByCodeOpts(w, requestID, core.CSRFOriginRejected.Value, "The request origin is not permitted.", 0, m.opts.Json)
	return false
}

func (m *Middleware) checkFetchMetadata(r *http.Request, w http.ResponseWriter, requestID string) bool {
	site := headerPtr(r, "Sec-Fetch-Site")
	mode := headerPtr(r, "Sec-Fetch-Mode")
	decision := core.EvaluateFetchMetadata(site, mode, m.opts.FetchMetadata)
	if decision.Decision == "reject" {
		m.metrics().RecordFetchMetadataRejected()
		SendErrorByCodeOpts(w, requestID, core.CSRFOriginRejected.Value, "The request fetch metadata is not permitted.", 0, m.opts.Json)
		return false
	}
	return true
}

func (m *Middleware) handleCSRFBootstrap(w http.ResponseWriter, r *http.Request, cw *correlationWriter, requestID string) {
	binding := m.csrfBind.Resolve(r)
	if binding == nil {
		SendErrorByCodeOpts(cw, requestID, core.CSRFTokenInvalid.Value, "The CSRF token could not be issued.", 0, m.opts.Json)
		return
	}
	token, err := m.csrf.IssueToken(binding.Source, binding.Kind)
	if err != nil {
		m.metrics().RecordCsrfRejected()
		SendErrorByCodeOpts(cw, requestID, core.CSRFTokenInvalid.Value, "The CSRF token could not be issued.", 0, m.opts.Json)
		return
	}
	m.metrics().RecordCsrfIssued()
	// Rotation policy: onBootstrap/onWindow record a marker so previously
	// issued tokens for this binding validate as rotated; never skips.
	if m.opts.Csrf.RotationPolicy != "never" {
		m.csrf.MarkRotated(binding.Fingerprint)
	}
	meta := core.CreateMeta(requestID, nil)
	payload := map[string]any{
		"success": true,
		"data":    map[string]any{"token": token},
		"message": nil,
		"meta":    meta,
	}
	body, _ := json.Marshal(payload)
	cw.Header().Set("Content-Type", "application/json; charset=utf-8")
	cw.Header().Set("Cache-Control", "no-store")
	cw.Header().Set("Content-Length", itoa(len(body)))
	cw.WriteHeader(http.StatusOK)
	_, _ = cw.Write(body)
}

func (m *Middleware) checkCSRF(r *http.Request, w http.ResponseWriter, requestID string) bool {
	token := r.Header.Get(m.opts.Csrf.HeaderName)
	binding := m.csrfBind.Resolve(r)
	if binding == nil {
		SendErrorByCodeOpts(w, requestID, core.CSRFTokenInvalid.Value, "The CSRF token could not be validated.", 0, m.opts.Json)
		return false
	}
	result := m.csrf.ValidateToken(token, binding.Fingerprint)
	switch result.Outcome {
	case OutcomeValid:
		m.metrics().RecordCsrfValidated()
		return true
	case OutcomeExpired:
		m.metrics().RecordCsrfExpired()
		SendErrorByCodeOpts(w, requestID, core.CSRFTokenExpired.Value, "The CSRF token has expired.", 0, m.opts.Json)
	case OutcomeMissingToken:
		m.metrics().RecordCsrfRejected()
		SendErrorByCodeOpts(w, requestID, core.CSRFHeaderMissing.Value, "The CSRF token header is missing.", 0, m.opts.Json)
	default:
		m.metrics().RecordCsrfRejected()
		SendErrorByCodeOpts(w, requestID, core.CSRFTokenInvalid.Value, "The CSRF token is invalid.", 0, m.opts.Json)
	}
	return false
}

func (m *Middleware) handleException(w http.ResponseWriter, requestID string, rec any) {
	// If the response already started, we cannot send an envelope.
	if cw, ok := w.(*correlationWriter); ok && cw.started {
		return
	}

	err, _ := rec.(error)
	if err == nil {
		err = &panicError{value: rec}
	}

	// Custom mappers first.
	for _, mapper := range m.opts.ExceptionMappers {
		if code, message, ok := mapper(err); ok {
			SendErrorByCodeOpts(w, requestID, code, message, 0, m.opts.Json)
			return
		}
	}

	// HTTPError-style errors with 4xx status.
	if he, ok := err.(interface{ StatusCode() int }); ok {
		status := he.StatusCode()
		if status >= 400 && status < 500 {
			code := core.ValidationError
			if status == http.StatusNotFound {
				code = core.ResourceNotFound
			} else if status == http.StatusConflict {
				code = core.Conflict
			}
			SendErrorOpts(w, requestID, code, "The request could not be processed.", status, nil, nil, m.opts.Json)
			return
		}
	}

	message := "An unexpected error occurred."
	if m.opts.Exceptions.RevealExceptionMessage {
		message = err.Error()
	}
	SendErrorByCodeOpts(w, requestID, core.InternalError.Value, message, 0, m.opts.Json)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// correlationWriter injects the correlation response header on first write
// and tracks whether the response has started.
type correlationWriter struct {
	http.ResponseWriter
	headerName string
	requestID  string
	started    bool
}

func (w *correlationWriter) WriteHeader(status int) {
	if !w.started {
		w.started = true
		if w.requestID != "" {
			w.Header().Set(w.headerName, w.requestID)
		}
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *correlationWriter) Write(b []byte) (int, error) {
	if !w.started {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

// Unwrap supports http.ResponseController (Go 1.20+).
func (w *correlationWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func headerPtr(r *http.Request, name string) *string {
	v := r.Header.Get(name)
	if v == "" {
		// Distinguish absent from empty: Header.Get returns "" for both.
		if _, ok := r.Header[http.CanonicalHeaderKey(name)]; !ok {
			return nil
		}
	}
	return &v
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func containsFold(list []string, value string) bool {
	for _, item := range list {
		if strings.EqualFold(item, value) {
			return true
		}
	}
	return false
}

func extractOriginFromReferer(referer string) string {
	u, err := url.Parse(referer)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func queryToMap(q url.Values) map[string][]string {
	out := make(map[string][]string, len(q))
	for k, v := range q {
		out[k] = v
	}
	return out
}

// panicError wraps a non-error panic value.
type panicError struct{ value any }

func (e *panicError) Error() string {
	return fmt.Sprintf("%v", e.value)
}

// ---------------------------------------------------------------------------
// Context helpers for handlers
// ---------------------------------------------------------------------------

// RequestID returns the correlation ID stored in the request context.
func RequestID(r *http.Request) string {
	if id, ok := r.Context().Value(ctxRequestID).(string); ok {
		return id
	}
	return ""
}

// Pagination returns the parsed pagination result from the request context.
func Pagination(r *http.Request) (core.ParsedPaginationQuery, bool) {
	p, ok := r.Context().Value(ctxPagination).(core.ParsedPaginationQuery)
	return p, ok
}
