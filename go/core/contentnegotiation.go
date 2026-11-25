package core

import "strings"

// ContentNegotiationOptions is the content negotiation configuration.
type ContentNegotiationOptions struct {
	AcceptableResponseMediaTypes []string // case-insensitive membership
	AcceptWildcard               bool
	AcceptableRequestMediaTypes  []string // case-insensitive membership
	AcceptMissingContentType     bool
	BodyCarryingMethods          []string // case-insensitive membership
}

// DefaultContentNegotiationOptions returns the default options.
func DefaultContentNegotiationOptions() ContentNegotiationOptions {
	return ContentNegotiationOptions{
		AcceptableResponseMediaTypes: []string{"application/json"},
		AcceptWildcard:               true,
		AcceptableRequestMediaTypes:  []string{"application/json"},
		AcceptMissingContentType:     false,
		BodyCarryingMethods:          []string{"POST", "PUT", "PATCH"},
	}
}

// NegotiationStatus is 200 | 406 | 415.
type NegotiationStatus int

const (
	StatusOK            NegotiationStatus = 200
	StatusNotAcceptable NegotiationStatus = 406
	StatusUnsupported   NegotiationStatus = 415
)

// CheckResult is "accept" | "reject" | "skip".
type CheckResult string

const (
	CheckAccept CheckResult = "accept"
	CheckReject CheckResult = "reject"
	CheckSkip   CheckResult = "skip"
)

// NegotiationDecision is the full negotiation result.
type NegotiationDecision struct {
	AcceptResult      CheckResult
	ContentTypeResult CheckResult
	Status            NegotiationStatus
}

func containsCaseInsensitive(list []string, value string) bool {
	lowered := strings.ToLower(value)
	for _, entry := range list {
		if strings.ToLower(entry) == lowered {
			return true
		}
	}
	return false
}

// ExtractMediaType takes the segment before the first ';', trimmed.
func ExtractMediaType(headerValue string) string {
	semi := strings.Index(headerValue, ";")
	segment := headerValue
	if semi >= 0 {
		segment = headerValue[:semi]
	}
	return strings.TrimSpace(segment)
}

// IsAcceptHeaderAcceptable evaluates the Accept header.
// Mirrors IsAcceptHeaderAcceptable:
//   - missing/empty → accept
//   - comma-split, trim, skip empty
//   - media type = before first ';' (q= and params ignored)
//   - "*/*" accepted iff AcceptWildcard (exact match)
//   - otherwise case-insensitive membership
//   - type wildcards like "application/*" are NOT honored
func IsAcceptHeaderAcceptable(headerValue *string, options ContentNegotiationOptions) bool {
	if headerValue == nil || *headerValue == "" {
		return true
	}
	for _, rawEntry := range strings.Split(*headerValue, ",") {
		entry := strings.TrimSpace(rawEntry)
		if entry == "" {
			continue
		}
		mediaType := ExtractMediaType(entry)
		if mediaType == "" {
			continue
		}
		if options.AcceptWildcard && mediaType == "*/*" {
			return true
		}
		if containsCaseInsensitive(options.AcceptableResponseMediaTypes, mediaType) {
			return true
		}
	}
	return false
}

// IsContentTypeAcceptable checks a single Content-Type header value.
func IsContentTypeAcceptable(headerValue string, options ContentNegotiationOptions) bool {
	mediaType := ExtractMediaType(headerValue)
	return containsCaseInsensitive(options.AcceptableRequestMediaTypes, mediaType)
}

// EvaluateContentNegotiation produces the full negotiation decision.
// Mirrors ApiPilotContentNegotiationMiddleware.InvokeAsync:
//  1. Accept check (only when header present) → 406
//  2. Content-Type check only for body-carrying methods → 415
//     Missing Content-Type on body-carrying method → reject unless
//     AcceptMissingContentType.
func EvaluateContentNegotiation(accept, contentType *string, method string, options ContentNegotiationOptions) NegotiationDecision {
	acceptResult := CheckAccept
	if !IsAcceptHeaderAcceptable(accept, options) {
		acceptResult = CheckReject
	}
	if acceptResult == CheckReject {
		return NegotiationDecision{AcceptResult: acceptResult, ContentTypeResult: CheckSkip, Status: StatusNotAcceptable}
	}

	isBodyCarrying := false
	for _, m := range options.BodyCarryingMethods {
		if strings.EqualFold(m, method) {
			isBodyCarrying = true
			break
		}
	}
	if !isBodyCarrying {
		return NegotiationDecision{AcceptResult: acceptResult, ContentTypeResult: CheckSkip, Status: StatusOK}
	}

	if contentType == nil || *contentType == "" {
		if options.AcceptMissingContentType {
			return NegotiationDecision{AcceptResult: acceptResult, ContentTypeResult: CheckAccept, Status: StatusOK}
		}
		return NegotiationDecision{AcceptResult: acceptResult, ContentTypeResult: CheckReject, Status: StatusUnsupported}
	}

	if !IsContentTypeAcceptable(*contentType, options) {
		return NegotiationDecision{AcceptResult: acceptResult, ContentTypeResult: CheckReject, Status: StatusUnsupported}
	}

	return NegotiationDecision{AcceptResult: acceptResult, ContentTypeResult: CheckAccept, Status: StatusOK}
}
