package core

import (
	"net/url"
	"strconv"
	"strings"
)

// OriginParts is a parsed origin. Port is 0 when the scheme has no default.
type OriginParts struct {
	Scheme string
	Host   string
	Port   int
}

func defaultPort(scheme string) int {
	switch scheme {
	case "https", "wss":
		return 443
	case "http", "ws":
		return 80
	}
	return 0
}

// TryParseOrigin parses an origin string into normalized parts.
// Returns (parts, true) or (zero, false). Never panics on malformed input.
// Mirrors OriginValidator (C#).
func TryParseOrigin(raw string) (OriginParts, bool) {
	if raw == "" || strings.EqualFold(raw, "null") {
		return OriginParts{}, false
	}

	u, err := url.Parse(raw)
	if err != nil {
		return OriginParts{}, false
	}

	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	if scheme == "" || host == "" {
		return OriginParts{}, false
	}

	// An origin has no path (beyond "/"), query, or fragment.
	if u.Path != "" && u.Path != "/" {
		return OriginParts{}, false
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return OriginParts{}, false
	}

	port := defaultPort(scheme)
	if p := u.Port(); p != "" {
		parsed, err := strconv.Atoi(p)
		if err != nil {
			return OriginParts{}, false
		}
		port = parsed
	}

	return OriginParts{Scheme: scheme, Host: host, Port: port}, true
}

// OriginMatches compares two origin strings under the given mode.
// Modes: "exact", "anyPortSameHost", "sameSite" (always false — not implemented).
func OriginMatches(requestOrigin, allowedOrigin, mode string) bool {
	req, ok1 := TryParseOrigin(requestOrigin)
	allowed, ok2 := TryParseOrigin(allowedOrigin)
	if !ok1 || !ok2 {
		return false
	}
	if req.Scheme != allowed.Scheme || req.Host != allowed.Host {
		return false
	}
	switch mode {
	case "exact":
		return req.Port == allowed.Port
	case "anyPortSameHost":
		return true
	}
	return false // sameSite — not implemented
}
