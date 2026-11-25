package httpapi

import (
	"net/http"

	"github.com/sancy1/ApiPilot-Ports/go/core"
)

// SafeMethods are the HTTP methods that skip origin/fetch-metadata/CSRF checks.
var SafeMethods = map[string]bool{
	"GET": true, "HEAD": true, "OPTIONS": true, "TRACE": true,
}

// OriginPolicyOptions configures the Origin/Referer policy.
type OriginPolicyOptions struct {
	Enabled              bool
	AllowedOrigins       []string
	MatchMode            string // "exact" | "anyPortSameHost" | "sameSite"
	RequireOriginHeader  bool
	AllowRefererFallback bool
}

// DefaultOriginPolicyOptions returns the defaults (disabled).
func DefaultOriginPolicyOptions() OriginPolicyOptions {
	return OriginPolicyOptions{
		MatchMode:            "exact",
		RequireOriginHeader:  true,
		AllowRefererFallback: true,
	}
}

// CsrfOptions configures CSRF protection.
type CsrfOptions struct {
	Enabled              bool
	HeaderName           string
	BootstrapPath        string
	TokenLifetimeSeconds int
	TokenEntropyBytes    int
	ProtectedMethods     []string

	// RotationPolicy decides when bootstrap records a rotation marker:
	// "onBootstrap" (default) | "onWindow" | "never".
	// Mirrors CsrfRotationPolicy (C#).
	RotationPolicy string
	// RotationRequirement: "optional" (default) | "required".
	// "required" makes New() fail when no RotationStore is configured.
	// Mirrors CsrfRotationRequirement (C#).
	RotationRequirement string
	// RotationStore persists per-binding rotation markers. Nil →
	// expiry-only rotation mode. Mirrors ICsrfRotationStore (C#).
	RotationStore RotationStore
}

// DefaultCsrfOptions returns the defaults (disabled).
func DefaultCsrfOptions() CsrfOptions {
	return CsrfOptions{
		HeaderName:           "X-CSRF-Token",
		BootstrapPath:        "/api/csrf",
		TokenLifetimeSeconds: 7200,
		TokenEntropyBytes:    32,
		ProtectedMethods:     []string{"POST", "PUT", "PATCH", "DELETE"},
		RotationPolicy:       "onBootstrap",
		RotationRequirement:  "optional",
	}
}

// CookieProfilesOptions holds the three cookie profiles.
type CookieProfilesOptions struct {
	Auth    core.CookieProfile
	Session core.CookieProfile
	Csrf    core.CookieProfile
}

// DefaultCookieProfilesOptions returns the default profiles.
func DefaultCookieProfilesOptions() CookieProfilesOptions {
	p := core.DefaultCookieProfiles()
	return CookieProfilesOptions{Auth: p["auth"], Session: p["session"], Csrf: p["csrf"]}
}

// ExceptionOptions configures exception mapping.
type ExceptionOptions struct {
	RevealExceptionMessage bool
	RevealExceptionDetails bool
}

// RateLimitOptions configures rate limiting. When Enabled, the middleware
// enforces a fixed-window limit per client key and rejects with a
// RATE_LIMITED envelope (mirrors ApiPilotRateLimitOptions, Option D).
type RateLimitOptions struct {
	Enabled           bool
	RequestsPerWindow int
	WindowSeconds     int
	// Message overrides the rejection message. Empty → "Too many requests. Retry later."
	Message string
	// EmitRetryAfter emits Retry-After when the window supplies a value. Default true.
	EmitRetryAfter bool
	// KeyExtractor derives the rate-limit key. Nil → ClientKey (RemoteAddr host).
	KeyExtractor func(r *http.Request) string
}

// JsonOptions configures JSON serialization.
// Mirrors ApiPilotJsonOptions (C#): naming policies, enum/date modes,
// indentation. Envelope keys are always pinned camelCase regardless of
// the naming policy — it applies to the data payload only.
type JsonOptions struct {
	// CamelCase is retained for backward compatibility; prefer
	// PropertyNamingPolicy. When PropertyNamingPolicy is empty and
	// CamelCase is true, camelCase is used.
	CamelCase bool
	// Indent pretty-prints JSON (development only).
	Indent bool
	// EnumMode: "string" (default) or "number".
	EnumMode EnumMode
	// DateMode: "iso8601" (default) or "unixSeconds".
	DateMode DateMode
	// PropertyNamingPolicy: "camelCase" (default), "snake_case", "passthrough".
	PropertyNamingPolicy NamingPolicy
	// DictionaryKeyPolicy applies to map keys; defaults to PropertyNamingPolicy.
	DictionaryKeyPolicy NamingPolicy
	// IgnoreNulls omits null values from maps and slices.
	IgnoreNulls bool
}

// ExceptionMapper maps an error to (code, message); return ok=false to pass through.
type ExceptionMapper func(err error) (code string, message string, ok bool)

// Options is the top-level ApiPilot configuration for the net/http adapter.
type Options struct {
	Correlation        core.CorrelationOptions
	ContentNegotiation core.ContentNegotiationOptions
	Origin             OriginPolicyOptions
	FetchMetadata      core.FetchMetadataOptions
	Csrf               CsrfOptions
	Cookies            CookieProfilesOptions
	Exceptions         ExceptionOptions
	RateLimit          RateLimitOptions
	Json               JsonOptions
	Pagination         core.PaginationOptions
	PaginationEnabled  bool

	// ExceptionMappers are consulted before the built-in mapping.
	ExceptionMappers []ExceptionMapper

	// Metrics receives pipeline counters. Nil → DefaultMetrics.
	Metrics *Metrics
}

// DefaultOptions returns the default options (all protections off except
// correlation + content negotiation defaults).
func DefaultOptions() Options {
	return Options{
		Correlation:        core.DefaultCorrelationOptions(),
		ContentNegotiation: core.DefaultContentNegotiationOptions(),
		Origin:             DefaultOriginPolicyOptions(),
		FetchMetadata:      core.DefaultFetchMetadataOptions(),
		Csrf:               DefaultCsrfOptions(),
		Cookies:            DefaultCookieProfilesOptions(),
		Pagination:         core.DefaultPaginationOptions(),
		RateLimit:          RateLimitOptions{EmitRetryAfter: true},
		Json: JsonOptions{
			CamelCase:            true,
			EnumMode:             EnumAsString,
			DateMode:             DateISO8601,
			PropertyNamingPolicy: NamingCamelCase,
		},
	}
}
