package core

import "strings"

// FetchMetadataProfile is "off" | "compat" | "strict".
type FetchMetadataProfile string

const (
	FetchMetadataOff    FetchMetadataProfile = "off"
	FetchMetadataCompat FetchMetadataProfile = "compat"
	FetchMetadataStrict FetchMetadataProfile = "strict"
)

// FetchMetadataOptions is the Fetch Metadata policy configuration.
type FetchMetadataOptions struct {
	Profile             FetchMetadataProfile
	AllowedSiteValues   map[string]bool // case-insensitive membership
	AllowedModeValues   map[string]bool // case-insensitive membership
	AllowMissingHeaders bool
}

// DefaultFetchMetadataOptions returns the default options.
func DefaultFetchMetadataOptions() FetchMetadataOptions {
	return FetchMetadataOptions{
		Profile: FetchMetadataOff,
		AllowedSiteValues: map[string]bool{
			"same-origin": true, "same-site": true, "none": true,
		},
		AllowedModeValues: map[string]bool{
			"cors": true, "same-origin": true, "navigate": true,
		},
		AllowMissingHeaders: true,
	}
}

var specSiteValues = map[string]bool{
	"same-origin": true, "same-site": true, "cross-site": true, "none": true,
}

// FetchMetadataDecision is the evaluation result.
type FetchMetadataDecision struct {
	Decision string // "allow" | "reject"
	Reason   string // "none" | "missingSiteHeader" | "malformedSiteHeader" | "disallowedSiteValue" | "disallowedModeValue"
}

var allowDecision = FetchMetadataDecision{Decision: "allow", Reason: "none"}

func containsCI(set map[string]bool, value string) bool {
	lowered := strings.ToLower(value)
	for k := range set {
		if strings.ToLower(k) == lowered {
			return true
		}
	}
	return false
}

// EvaluateFetchMetadata evaluates Sec-Fetch-Site / Sec-Fetch-Mode.
// Mirrors FetchMetadataEvaluator (C#). Compat and Strict produce
// IDENTICAL decisions — the profile distinction exists only for
// startup validation. Off short-circuits to allow.
func EvaluateFetchMetadata(site, mode *string, options FetchMetadataOptions) FetchMetadataDecision {
	if options.Profile == FetchMetadataOff {
		return allowDecision
	}

	siteMissing := site == nil || *site == ""
	siteWellFormed := false
	if !siteMissing {
		siteWellFormed = specSiteValues[strings.ToLower(*site)]
	}

	if !siteWellFormed {
		if options.AllowMissingHeaders {
			return allowDecision
		}
		if siteMissing {
			return FetchMetadataDecision{Decision: "reject", Reason: "missingSiteHeader"}
		}
		return FetchMetadataDecision{Decision: "reject", Reason: "malformedSiteHeader"}
	}

	// Present and well-formed — AllowMissingHeaders is not consulted.
	if !containsCI(options.AllowedSiteValues, *site) {
		return FetchMetadataDecision{Decision: "reject", Reason: "disallowedSiteValue"}
	}

	if mode != nil && *mode != "" && !containsCI(options.AllowedModeValues, *mode) {
		return FetchMetadataDecision{Decision: "reject", Reason: "disallowedModeValue"}
	}

	return allowDecision
}
