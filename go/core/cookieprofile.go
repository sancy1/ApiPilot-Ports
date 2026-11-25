package core

import "regexp"

// CookieSameSite is the SameSite attribute value.
type CookieSameSite string

const (
	SameSiteLax         CookieSameSite = "lax"
	SameSiteNone        CookieSameSite = "none"
	SameSiteStrict      CookieSameSite = "strict"
	SameSiteUnspecified CookieSameSite = "unspecified"
)

// CookieProfileRole identifies which profile is being validated.
type CookieProfileRole string

const (
	RoleAuth    CookieProfileRole = "auth"
	RoleSession CookieProfileRole = "session"
	RoleCSRF    CookieProfileRole = "csrf"
)

// CookieProfile is a cookie profile under validation.
type CookieProfile struct {
	Name       string
	Secure     bool
	HTTPOnly   bool
	SameSite   CookieSameSite
	Path       string
	Domain     *string // nil = no domain attribute
	NamePrefix string  // "", "__Host-", "__Secure-"
}

var definedPrefixes = map[string]bool{"": true, "__Host-": true, "__Secure-": true}

var forbiddenNameCharRe = regexp.MustCompile("[\\x00-\\x20\\x7f\",;\\\\]")
var domainRe = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$`)
var domainBadCharRe = regexp.MustCompile(`[\\s/:@]`)

// ValidateCookieProfile validates a cookie profile. Returns violation codes
// (empty slice = valid). Mirrors CookieProfileOptionsValidator +
// HostPrefixValidator (C#).
func ValidateCookieProfile(profile CookieProfile, role CookieProfileRole) []string {
	var violations []string
	effectiveName := profile.NamePrefix + profile.Name

	if !definedPrefixes[profile.NamePrefix] {
		violations = append(violations, "undefined-prefix")
	}

	if effectiveName == "" {
		violations = append(violations, "empty-name")
	} else if forbiddenNameCharRe.MatchString(effectiveName) {
		violations = append(violations, "forbidden-name-char")
	}

	if profile.NamePrefix == "__Host-" {
		if !profile.Secure {
			violations = append(violations, "host-prefix-requires-secure")
		}
		if profile.Domain != nil {
			violations = append(violations, "host-prefix-requires-no-domain")
		}
		if profile.Path != "/" {
			violations = append(violations, "host-prefix-requires-root-path")
		}
	}

	if profile.NamePrefix == "__Secure-" && !profile.Secure {
		violations = append(violations, "secure-prefix-requires-secure")
	}

	if profile.SameSite == SameSiteNone && !profile.Secure {
		violations = append(violations, "samesite-none-requires-secure")
	}

	if profile.SameSite == SameSiteUnspecified {
		violations = append(violations, "undefined-samesite")
	}

	if profile.Path == "" || profile.Path[0] != '/' {
		violations = append(violations, "path-must-start-slash")
	}

	if profile.Domain != nil && !isValidDomain(*profile.Domain) {
		violations = append(violations, "invalid-domain")
	}

	return violations
}

func isValidDomain(domain string) bool {
	if domain == "" || domainBadCharRe.MatchString(domain) {
		return false
	}
	return domainRe.MatchString(domain)
}

// DefaultCookieProfiles returns the three default profiles from docs/cookies.md.
func DefaultCookieProfiles() map[string]CookieProfile {
	return map[string]CookieProfile{
		"auth": {
			Name: "auth", Secure: true, HTTPOnly: true, SameSite: SameSiteLax,
			Path: "/", Domain: nil, NamePrefix: "",
		},
		"session": {
			Name: "session", Secure: true, HTTPOnly: true, SameSite: SameSiteStrict,
			Path: "/", Domain: nil, NamePrefix: "",
		},
		"csrf": {
			Name: "csrf", Secure: true, HTTPOnly: false, SameSite: SameSiteLax,
			Path: "/", Domain: nil, NamePrefix: "",
		},
	}
}
