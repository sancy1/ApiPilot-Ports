package core

import (
	"fmt"
	"strings"
)

// ApiErrorCode is the ApiPilot error code with its default HTTP status.
// Mirrors ApiPilot.Core.Errors.ApiErrorCode (C#).
type ApiErrorCode struct {
	Value      string
	HTTPStatus int
}

// The fourteen standard codes, in SPEC.md table order.
var (
	ValidationError        = ApiErrorCode{Value: "VALIDATION_ERROR", HTTPStatus: 400}
	AuthenticationRequired = ApiErrorCode{Value: "AUTHENTICATION_REQUIRED", HTTPStatus: 401}
	Forbidden              = ApiErrorCode{Value: "FORBIDDEN", HTTPStatus: 403}
	CSRFHeaderMissing      = ApiErrorCode{Value: "CSRF_HEADER_MISSING", HTTPStatus: 403}
	CSRFTokenInvalid       = ApiErrorCode{Value: "CSRF_TOKEN_INVALID", HTTPStatus: 403}
	CSRFTokenExpired       = ApiErrorCode{Value: "CSRF_TOKEN_EXPIRED", HTTPStatus: 403}
	CSRFOriginRejected     = ApiErrorCode{Value: "CSRF_ORIGIN_REJECTED", HTTPStatus: 403}
	ResourceNotFound       = ApiErrorCode{Value: "RESOURCE_NOT_FOUND", HTTPStatus: 404}
	Conflict               = ApiErrorCode{Value: "CONFLICT", HTTPStatus: 409}
	RateLimited            = ApiErrorCode{Value: "RATE_LIMITED", HTTPStatus: 429}
	InternalError          = ApiErrorCode{Value: "INTERNAL_ERROR", HTTPStatus: 500}
	ConfigurationError     = ApiErrorCode{Value: "CONFIGURATION_ERROR", HTTPStatus: 500}
	NotAcceptable          = ApiErrorCode{Value: "NOT_ACCEPTABLE", HTTPStatus: 406}
	UnsupportedMediaType   = ApiErrorCode{Value: "UNSUPPORTED_MEDIA_TYPE", HTTPStatus: 415}
)

// AllStandard returns the fourteen standard codes in SPEC.md order.
func AllStandard() []ApiErrorCode {
	return []ApiErrorCode{
		ValidationError, AuthenticationRequired, Forbidden,
		CSRFHeaderMissing, CSRFTokenInvalid, CSRFTokenExpired, CSRFOriginRejected,
		ResourceNotFound, Conflict, RateLimited,
		InternalError, ConfigurationError, NotAcceptable, UnsupportedMediaType,
	}
}

var registry = func() map[string]ApiErrorCode {
	m := make(map[string]ApiErrorCode, 14)
	for _, c := range AllStandard() {
		m[c.Value] = c
	}
	return m
}()

// FromCode normalizes a raw string into an ApiErrorCode: trims and
// uppercases (invariant). Returns the canonical instance for standard
// codes; a new instance (HTTP 500) for custom codes.
// Returns an error when raw is empty or whitespace.
func FromCode(raw string) (ApiErrorCode, error) {
	normalized := strings.ToUpper(strings.TrimSpace(raw))
	if normalized == "" {
		return ApiErrorCode{}, fmt.Errorf("FromCode requires a non-empty string")
	}
	if c, ok := registry[normalized]; ok {
		return c, nil
	}
	return ApiErrorCode{Value: normalized, HTTPStatus: 500}, nil
}

// TryFromCode returns the canonical code for a wire string, or false.
func TryFromCode(raw string) (ApiErrorCode, bool) {
	c, err := FromCode(raw)
	if err != nil {
		return ApiErrorCode{}, false
	}
	return c, true
}
