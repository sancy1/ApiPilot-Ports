package httpapi

import (
	"regexp"
	"strings"
	"sync"
)

// Observability surface — mirrors ApiPilotCsrfCounters,
// ApiPilotRedactionPolicy, and ApiPilotSafeLogger (C#).
//
// Counters are in-memory and per-process; for multi-instance aggregation
// export them to your metrics pipeline (Prometheus, OpenTelemetry, etc.).

// Metrics holds ApiPilot request-pipeline counters.
type Metrics struct {
	mu sync.Mutex

	CsrfIssued      int64
	CsrfValidated   int64
	CsrfRejected    int64
	CsrfExpired     int64
	RateLimited     int64
	ValidationFailed int64
	OriginRejected  int64
	FetchMetaRejected int64
	CookieRejected  int64
}

// Default shared metrics instance used by the middleware when
// Options.Metrics is nil.
var DefaultMetrics = &Metrics{}

func (m *Metrics) inc(field *int64) {
	m.mu.Lock()
	*field++
	m.mu.Unlock()
}

// Snapshot returns a copy of the current counter values.
func (m *Metrics) Snapshot() map[string]int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return map[string]int64{
		"csrf.issued":          m.CsrfIssued,
		"csrf.validated":       m.CsrfValidated,
		"csrf.rejected":        m.CsrfRejected,
		"csrf.expired":         m.CsrfExpired,
		"rate_limited":         m.RateLimited,
		"validation_failed":    m.ValidationFailed,
		"origin_rejected":      m.OriginRejected,
		"fetch_metadata_rejected": m.FetchMetaRejected,
		"cookie_rejected":      m.CookieRejected,
	}
}

// RecordCsrfIssued increments the CSRF bootstrap counter.
func (m *Metrics) RecordCsrfIssued()      { m.inc(&m.CsrfIssued) }
// RecordCsrfValidated increments the CSRF validation-success counter.
func (m *Metrics) RecordCsrfValidated()   { m.inc(&m.CsrfValidated) }
// RecordCsrfRejected increments the CSRF rejection counter.
func (m *Metrics) RecordCsrfRejected()    { m.inc(&m.CsrfRejected) }
// RecordCsrfExpired increments the CSRF expiry counter.
func (m *Metrics) RecordCsrfExpired()     { m.inc(&m.CsrfExpired) }
// RecordRateLimited increments the rate-limit rejection counter.
func (m *Metrics) RecordRateLimited()     { m.inc(&m.RateLimited) }
// RecordValidationFailed increments the validation-error counter.
func (m *Metrics) RecordValidationFailed() { m.inc(&m.ValidationFailed) }
// RecordOriginRejected increments the origin-policy rejection counter.
func (m *Metrics) RecordOriginRejected()  { m.inc(&m.OriginRejected) }
// RecordFetchMetadataRejected increments the fetch-metadata rejection counter.
func (m *Metrics) RecordFetchMetadataRejected() { m.inc(&m.FetchMetaRejected) }
// RecordCookieRejected increments the cookie-policy rejection counter.
func (m *Metrics) RecordCookieRejected()  { m.inc(&m.CookieRejected) }

// RedactionPolicy controls which log fields are masked.
// Mirrors ApiPilotRedactionPolicy (C#).
type RedactionPolicy struct {
	// SensitiveKeys are field names whose values are replaced with "[REDACTED]".
	// Matching is case-insensitive substring match.
	SensitiveKeys []string
}

// DefaultRedactionPolicy returns the default sensitive-key set.
func DefaultRedactionPolicy() RedactionPolicy {
	return RedactionPolicy{
		SensitiveKeys: []string{
			"password", "passwd", "secret", "token", "apikey", "api_key",
			"authorization", "cookie", "session", "csrf", "creditcard",
			"ssn", "privatekey", "private_key",
		},
	}
}

var bearerPattern = regexp.MustCompile(`(?i)bearer\s+[a-z0-9\-._~+/]+=*`)

// RedactString masks bearer tokens and sensitive key=value pairs in a
// free-form string. Mirrors ApiPilotSafeLogger redaction (C#).
func RedactString(s string, policy RedactionPolicy) string {
	out := bearerPattern.ReplaceAllString(s, "Bearer [REDACTED]")
	for _, key := range policy.SensitiveKeys {
		// Mask "key=value" and "key: value" forms.
		pattern := regexp.MustCompile(`(?i)(` + regexp.QuoteMeta(key) + `)(\s*[=:]\s*)([^\s,;&]+)`)
		out = pattern.ReplaceAllString(out, "$1$2[REDACTED]")
	}
	return out
}

// RedactMap returns a copy of m with sensitive values masked.
func RedactMap(m map[string]any, policy RedactionPolicy) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		lower := strings.ToLower(k)
		sensitive := false
		for _, sk := range policy.SensitiveKeys {
			if strings.Contains(lower, strings.ToLower(sk)) {
				sensitive = true
				break
			}
		}
		if sensitive {
			out[k] = "[REDACTED]"
			continue
		}
		switch t := v.(type) {
		case string:
			out[k] = RedactString(t, policy)
		case map[string]any:
			out[k] = RedactMap(t, policy)
		default:
			out[k] = v
		}
	}
	return out
}
