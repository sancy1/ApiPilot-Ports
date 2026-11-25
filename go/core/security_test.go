package core_test

import (
	"strings"
	"testing"

	"github.com/sancy1/ApiPilot-Ports/go/core"
)

// ---------------------------------------------------------------------------
// Origin
// ---------------------------------------------------------------------------

func TestTryParseOriginValid(t *testing.T) {
	p, ok := core.TryParseOrigin("https://Example.COM:8443")
	if !ok {
		t.Fatal("should parse")
	}
	if p.Scheme != "https" || p.Host != "example.com" || p.Port != 8443 {
		t.Fatalf("parts = %+v", p)
	}
}

func TestTryParseOriginDefaultPorts(t *testing.T) {
	p, _ := core.TryParseOrigin("https://example.com")
	if p.Port != 443 {
		t.Fatalf("https default = %d", p.Port)
	}
	p, _ = core.TryParseOrigin("http://example.com")
	if p.Port != 80 {
		t.Fatalf("http default = %d", p.Port)
	}
}

func TestTryParseOriginRejects(t *testing.T) {
	for _, bad := range []string{
		"", "null", "not a url", "https://example.com/path",
		"https://example.com?q=1", "https://example.com#frag",
		"ftp://", "https://:8080", "https://example.com:abc",
	} {
		if _, ok := core.TryParseOrigin(bad); ok {
			t.Errorf("TryParseOrigin(%q) should fail", bad)
		}
	}
}

func TestOriginMatchesExact(t *testing.T) {
	if !core.OriginMatches("https://a.com", "https://a.com", "exact") {
		t.Error("same origin should match")
	}
	if core.OriginMatches("https://a.com:8443", "https://a.com", "exact") {
		t.Error("different port should not match exact")
	}
	if !core.OriginMatches("https://a.com:8443", "https://a.com:8443", "exact") {
		t.Error("same explicit port should match")
	}
}

func TestOriginMatchesAnyPortSameHost(t *testing.T) {
	if !core.OriginMatches("https://a.com:8443", "https://a.com", "anyPortSameHost") {
		t.Error("anyPortSameHost should match different ports")
	}
	if core.OriginMatches("https://a.com", "https://b.com", "anyPortSameHost") {
		t.Error("different host should not match")
	}
	if core.OriginMatches("http://a.com", "https://a.com", "anyPortSameHost") {
		t.Error("different scheme should not match")
	}
}

func TestOriginMatchesSameSiteAlwaysFalse(t *testing.T) {
	if core.OriginMatches("https://a.com", "https://a.com", "sameSite") {
		t.Error("sameSite is not implemented — must return false")
	}
}

func TestOriginMatchesInvalidInput(t *testing.T) {
	if core.OriginMatches("garbage", "https://a.com", "exact") {
		t.Error("invalid request origin should not match")
	}
}

// ---------------------------------------------------------------------------
// Fetch metadata
// ---------------------------------------------------------------------------

func TestFetchMetadataOffAlwaysAllows(t *testing.T) {
	opts := core.DefaultFetchMetadataOptions() // Profile: off
	d := core.EvaluateFetchMetadata(strPtr("cross-site"), strPtr("no-cors"), opts)
	if d.Decision != "allow" {
		t.Fatalf("off should allow: %+v", d)
	}
}

func TestFetchMetadataMissingHeadersAllowed(t *testing.T) {
	opts := core.DefaultFetchMetadataOptions()
	opts.Profile = core.FetchMetadataStrict
	d := core.EvaluateFetchMetadata(nil, nil, opts)
	if d.Decision != "allow" {
		t.Fatalf("missing headers should allow: %+v", d)
	}
}

func TestFetchMetadataMissingHeadersRejected(t *testing.T) {
	opts := core.DefaultFetchMetadataOptions()
	opts.Profile = core.FetchMetadataStrict
	opts.AllowMissingHeaders = false
	d := core.EvaluateFetchMetadata(nil, nil, opts)
	if d.Decision != "reject" || d.Reason != "missingSiteHeader" {
		t.Fatalf("got %+v", d)
	}
}

func TestFetchMetadataMalformedSite(t *testing.T) {
	opts := core.DefaultFetchMetadataOptions()
	opts.Profile = core.FetchMetadataCompat
	opts.AllowMissingHeaders = false
	d := core.EvaluateFetchMetadata(strPtr("bogus"), nil, opts)
	if d.Decision != "reject" || d.Reason != "malformedSiteHeader" {
		t.Fatalf("got %+v", d)
	}
}

func TestFetchMetadataDisallowedSite(t *testing.T) {
	opts := core.DefaultFetchMetadataOptions()
	opts.Profile = core.FetchMetadataStrict
	d := core.EvaluateFetchMetadata(strPtr("cross-site"), nil, opts)
	if d.Decision != "reject" || d.Reason != "disallowedSiteValue" {
		t.Fatalf("got %+v", d)
	}
}

func TestFetchMetadataDisallowedMode(t *testing.T) {
	opts := core.DefaultFetchMetadataOptions()
	opts.Profile = core.FetchMetadataStrict
	d := core.EvaluateFetchMetadata(strPtr("same-origin"), strPtr("no-cors"), opts)
	if d.Decision != "reject" || d.Reason != "disallowedModeValue" {
		t.Fatalf("got %+v", d)
	}
}

func TestFetchMetadataCompatEqualsStrict(t *testing.T) {
	strict := core.DefaultFetchMetadataOptions()
	strict.Profile = core.FetchMetadataStrict
	compat := core.DefaultFetchMetadataOptions()
	compat.Profile = core.FetchMetadataCompat
	site, mode := strPtr("cross-site"), strPtr("cors")
	d1 := core.EvaluateFetchMetadata(site, mode, strict)
	d2 := core.EvaluateFetchMetadata(site, mode, compat)
	if d1 != d2 {
		t.Fatalf("compat != strict: %+v vs %+v", d1, d2)
	}
}

func TestFetchMetadataCaseInsensitive(t *testing.T) {
	opts := core.DefaultFetchMetadataOptions()
	opts.Profile = core.FetchMetadataStrict
	d := core.EvaluateFetchMetadata(strPtr("SAME-ORIGIN"), strPtr("CORS"), opts)
	if d.Decision != "allow" {
		t.Fatalf("case-insensitive should allow: %+v", d)
	}
}

// ---------------------------------------------------------------------------
// Cookie profiles
// ---------------------------------------------------------------------------

func TestDefaultCookieProfilesAreValid(t *testing.T) {
	profiles := core.DefaultCookieProfiles()
	for role, p := range profiles {
		var r core.CookieProfileRole
		switch role {
		case "auth":
			r = core.RoleAuth
		case "session":
			r = core.RoleSession
		case "csrf":
			r = core.RoleCSRF
		}
		if v := core.ValidateCookieProfile(p, r); len(v) != 0 {
			t.Errorf("default %s profile invalid: %v", role, v)
		}
	}
}

func TestCookieProfileHostPrefixRules(t *testing.T) {
	p := core.CookieProfile{
		Name: "x", Secure: false, HTTPOnly: true, SameSite: core.SameSiteLax,
		Path: "/", NamePrefix: "__Host-",
	}
	v := core.ValidateCookieProfile(p, core.RoleAuth)
	if !containsStr(v, "host-prefix-requires-secure") {
		t.Fatalf("missing secure violation: %v", v)
	}
	if containsStr(v, "host-prefix-requires-root-path") {
		t.Fatalf("path / should not violate: %v", v)
	}
}

func TestCookieProfileHostPrefixDomain(t *testing.T) {
	d := "example.com"
	p := core.CookieProfile{
		Name: "x", Secure: true, HTTPOnly: true, SameSite: core.SameSiteLax,
		Path: "/", Domain: &d, NamePrefix: "__Host-",
	}
	v := core.ValidateCookieProfile(p, core.RoleAuth)
	if !containsStr(v, "host-prefix-requires-no-domain") {
		t.Fatalf("missing domain violation: %v", v)
	}
}

func TestCookieProfileSameSiteNoneRequiresSecure(t *testing.T) {
	p := core.CookieProfile{
		Name: "x", Secure: false, HTTPOnly: true, SameSite: core.SameSiteNone,
		Path: "/",
	}
	v := core.ValidateCookieProfile(p, core.RoleAuth)
	if !containsStr(v, "samesite-none-requires-secure") {
		t.Fatalf("missing samesite-none violation: %v", v)
	}
}

func TestCookieProfileUnspecifiedSameSite(t *testing.T) {
	p := core.CookieProfile{
		Name: "x", Secure: true, HTTPOnly: true, SameSite: core.SameSiteUnspecified,
		Path: "/",
	}
	v := core.ValidateCookieProfile(p, core.RoleAuth)
	if !containsStr(v, "undefined-samesite") {
		t.Fatalf("missing samesite violation: %v", v)
	}
}

func TestCookieProfileBadPath(t *testing.T) {
	p := core.CookieProfile{
		Name: "x", Secure: true, HTTPOnly: true, SameSite: core.SameSiteLax,
		Path: "relative",
	}
	v := core.ValidateCookieProfile(p, core.RoleAuth)
	if !containsStr(v, "path-must-start-slash") {
		t.Fatalf("missing path violation: %v", v)
	}
}

func TestCookieProfileForbiddenNameChar(t *testing.T) {
	p := core.CookieProfile{
		Name: "bad;name", Secure: true, HTTPOnly: true, SameSite: core.SameSiteLax,
		Path: "/",
	}
	v := core.ValidateCookieProfile(p, core.RoleAuth)
	if !containsStr(v, "forbidden-name-char") {
		t.Fatalf("missing name-char violation: %v", v)
	}
}

func TestCookieProfileInvalidDomain(t *testing.T) {
	d := "bad domain.com"
	p := core.CookieProfile{
		Name: "x", Secure: true, HTTPOnly: true, SameSite: core.SameSiteLax,
		Path: "/", Domain: &d,
	}
	v := core.ValidateCookieProfile(p, core.RoleAuth)
	if !containsStr(v, "invalid-domain") {
		t.Fatalf("missing domain violation: %v", v)
	}
}

func containsStr(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// CSRF payload codec
// ---------------------------------------------------------------------------

func TestCsrfPayloadRoundTrip(t *testing.T) {
	payload, err := core.EncodeCsrfPayload(1700000000, "abc123", "fp")
	if err != nil {
		t.Fatal(err)
	}
	parts, ok := core.TryDecodeCsrfPayload(payload)
	if !ok {
		t.Fatal("decode failed")
	}
	if parts.IssuedAtUnixSeconds != 1700000000 || parts.RandomBase64URL != "abc123" || parts.BindingFingerprint != "fp" {
		t.Fatalf("parts = %+v", parts)
	}
}

func TestCsrfPayloadEncodeRejectsDelimiter(t *testing.T) {
	if _, err := core.EncodeCsrfPayload(1, "a|b", "fp"); err == nil {
		t.Error("delimiter in random should fail")
	}
	if _, err := core.EncodeCsrfPayload(1, "abc", "f|p"); err == nil {
		t.Error("delimiter in fingerprint should fail")
	}
	if _, err := core.EncodeCsrfPayload(1, "", "fp"); err == nil {
		t.Error("empty random should fail")
	}
	if _, err := core.EncodeCsrfPayload(1, "abc", ""); err == nil {
		t.Error("empty fingerprint should fail")
	}
}

func TestCsrfPayloadDecodeRejects(t *testing.T) {
	for _, bad := range []string{
		"", "a|b", "a|b|c|d", "x|y|z", "1.5|r|f",
		"|r|f", "1||f", "1|r|",
		"99999999999999999999|r|f", // out of int64 range
	} {
		if _, ok := core.TryDecodeCsrfPayload(bad); ok {
			t.Errorf("TryDecodeCsrfPayload(%q) should fail", bad)
		}
	}
}

func TestCsrfPayloadTimeBounds(t *testing.T) {
	// Min bound.
	p, err := core.EncodeCsrfPayload(core.MinUnixSeconds, "r", "f")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := core.TryDecodeCsrfPayload(p); !ok {
		t.Error("min bound should decode")
	}
	// Below min.
	p2 := "-62135596801|r|f"
	if _, ok := core.TryDecodeCsrfPayload(p2); ok {
		t.Error("below min should fail")
	}
	// Above max.
	p3 := "253402300800|r|f"
	if _, ok := core.TryDecodeCsrfPayload(p3); ok {
		t.Error("above max should fail")
	}
}

// ---------------------------------------------------------------------------
// CSRF binding fingerprint
// ---------------------------------------------------------------------------

func TestCsrfBindingFingerprintDeterministic(t *testing.T) {
	f1 := core.CsrfBindingFingerprint("user-1", core.BindingSubject)
	f2 := core.CsrfBindingFingerprint("user-1", core.BindingSubject)
	if f1 != f2 {
		t.Fatal("fingerprint not deterministic")
	}
	if len(f1) != 43 {
		t.Fatalf("fingerprint length = %d, want 43 (base64url sha256)", len(f1))
	}
}

func TestCsrfBindingFingerprintKindSeparation(t *testing.T) {
	subject := core.CsrfBindingFingerprint("x", core.BindingSubject)
	session := core.CsrfBindingFingerprint("x", core.BindingSession)
	preauth := core.CsrfBindingFingerprint("x", core.BindingPreAuth)
	if subject == session || subject == preauth || session == preauth {
		t.Fatal("kinds must produce distinct fingerprints")
	}
}

func TestCsrfBindingFingerprintSourceSeparation(t *testing.T) {
	a := core.CsrfBindingFingerprint("user-a", core.BindingSubject)
	b := core.CsrfBindingFingerprint("user-b", core.BindingSubject)
	if a == b {
		t.Fatal("different sources must produce different fingerprints")
	}
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

func TestResolveCorrelationAbsentGenerates(t *testing.T) {
	d := core.ResolveCorrelationID(nil, core.DefaultCorrelationOptions(), false)
	if d.Kind != core.DecisionGenerate {
		t.Fatalf("kind = %v", d.Kind)
	}
}

func TestResolveCorrelationValidIncoming(t *testing.T) {
	v := "req-abc-12345"
	d := core.ResolveCorrelationID(&v, core.DefaultCorrelationOptions(), true)
	if d.Kind != core.DecisionUseIncoming || d.ID != v {
		t.Fatalf("decision = %+v", d)
	}
}

func TestResolveCorrelationInvalidReplace(t *testing.T) {
	v := "bad id with spaces!"
	opts := core.DefaultCorrelationOptions()
	d := core.ResolveCorrelationID(&v, opts, false)
	if d.Kind != core.DecisionGenerate {
		t.Fatalf("replace policy should generate: %+v", d)
	}
}

func TestResolveCorrelationInvalidReject(t *testing.T) {
	v := "bad id!"
	opts := core.DefaultCorrelationOptions()
	opts.InvalidIDPolicy = core.InvalidIDReject
	d := core.ResolveCorrelationID(&v, opts, false)
	if d.Kind != core.DecisionReject {
		t.Fatalf("reject policy: %+v", d)
	}
}

func TestResolveCorrelationInvalidUseAsIs(t *testing.T) {
	v := "bad id!"
	opts := core.DefaultCorrelationOptions()
	opts.InvalidIDPolicy = core.InvalidIDUseAsIs
	d := core.ResolveCorrelationID(&v, opts, false)
	if d.Kind != core.DecisionUseIncoming || d.ID != v || !d.Warn {
		t.Fatalf("useAsIs policy: %+v", d)
	}
}

func TestGenerateGUIDv7Format(t *testing.T) {
	id := core.GenerateGUIDv7()
	// 8-4-4-4-12 hex.
	parts := strings.Split(id, "-")
	if len(parts) != 5 {
		t.Fatalf("format: %q", id)
	}
	if len(parts[0]) != 8 || len(parts[1]) != 4 || len(parts[2]) != 4 || len(parts[3]) != 4 || len(parts[4]) != 12 {
		t.Fatalf("segment lengths: %q", id)
	}
	// Version nibble = 7.
	if parts[2][0] != '7' {
		t.Fatalf("version nibble: %q", id)
	}
	// Variant bits: first char of segment 4 must be 8/9/a/b.
	if !strings.ContainsRune("89ab", rune(parts[3][0])) {
		t.Fatalf("variant bits: %q", id)
	}
	for _, c := range id {
		if !strings.ContainsRune("0123456789abcdef-", c) {
			t.Fatalf("non-hex char in %q", id)
		}
	}
}

func TestGenerateGUIDv7Unique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 1000; i++ {
		id := core.GenerateGUIDv7()
		if seen[id] {
			t.Fatalf("duplicate GUIDv7: %s", id)
		}
		seen[id] = true
	}
}

func TestGenerateGUIDv7TimeOrdered(t *testing.T) {
	// Two IDs generated sequentially should have non-decreasing timestamp prefix.
	a := core.GenerateGUIDv7()
	b := core.GenerateGUIDv7()
	// Compare first 12 hex chars (48-bit ms timestamp).
	if a[:12] > b[:12] {
		t.Fatalf("time ordering violated: %s > %s", a, b)
	}
}

// ---------------------------------------------------------------------------
// Content negotiation
// ---------------------------------------------------------------------------

func TestExtractMediaType(t *testing.T) {
	if got := core.ExtractMediaType("application/json; charset=utf-8"); got != "application/json" {
		t.Fatalf("got %q", got)
	}
	if got := core.ExtractMediaType("  text/html  "); got != "text/html" {
		t.Fatalf("got %q", got)
	}
	if got := core.ExtractMediaType("application/json"); got != "application/json" {
		t.Fatalf("got %q", got)
	}
}

func TestAcceptHeaderQValuesIgnored(t *testing.T) {
	opts := core.DefaultContentNegotiationOptions()
	// q= parameters are stripped — media type before ';' is what matters.
	if !core.IsAcceptHeaderAcceptable(strPtr("text/html;q=0.9, application/json;q=0.8"), opts) {
		t.Error("application/json entry should be accepted")
	}
}

func TestAcceptHeaderTypeWildcardNotHonored(t *testing.T) {
	opts := core.DefaultContentNegotiationOptions()
	// "application/*" is NOT a wildcard per the contract — only "*/*" is.
	if core.IsAcceptHeaderAcceptable(strPtr("application/*"), opts) {
		t.Error("application/* should not be accepted")
	}
}

func TestAcceptHeaderMissingAccepts(t *testing.T) {
	opts := core.DefaultContentNegotiationOptions()
	if !core.IsAcceptHeaderAcceptable(nil, opts) {
		t.Error("missing Accept should accept")
	}
	if !core.IsAcceptHeaderAcceptable(strPtr(""), opts) {
		t.Error("empty Accept should accept")
	}
}

func TestAcceptHeaderRejectsAll(t *testing.T) {
	opts := core.DefaultContentNegotiationOptions()
	if core.IsAcceptHeaderAcceptable(strPtr("text/html, application/xml"), opts) {
		t.Error("should reject")
	}
}

func TestAcceptWildcardDisabled(t *testing.T) {
	opts := core.DefaultContentNegotiationOptions()
	opts.AcceptWildcard = false
	if core.IsAcceptHeaderAcceptable(strPtr("*/*"), opts) {
		t.Error("wildcard disabled should reject */*")
	}
}

func TestContentTypeCaseInsensitive(t *testing.T) {
	opts := core.DefaultContentNegotiationOptions()
	if !core.IsContentTypeAcceptable("Application/JSON; charset=utf-8", opts) {
		t.Error("case-insensitive content type should pass")
	}
}

func TestEvaluateNegotiationGetSkipsContentType(t *testing.T) {
	opts := core.DefaultContentNegotiationOptions()
	// GET is not body-carrying → no Content-Type needed.
	d := core.EvaluateContentNegotiation(nil, nil, "GET", opts)
	if d.Status != core.StatusOK {
		t.Fatalf("GET should be OK: %+v", d)
	}
}

func TestEvaluateNegotiationPostMissingContentType(t *testing.T) {
	opts := core.DefaultContentNegotiationOptions()
	d := core.EvaluateContentNegotiation(nil, nil, "POST", opts)
	if d.Status != core.StatusUnsupported {
		t.Fatalf("POST without Content-Type should be 415: %+v", d)
	}
}

func TestEvaluateNegotiationPostMissingAllowed(t *testing.T) {
	opts := core.DefaultContentNegotiationOptions()
	opts.AcceptMissingContentType = true
	d := core.EvaluateContentNegotiation(nil, nil, "POST", opts)
	if d.Status != core.StatusOK {
		t.Fatalf("AcceptMissingContentType should allow: %+v", d)
	}
}

func TestEvaluateNegotiationAcceptRejectsFirst(t *testing.T) {
	opts := core.DefaultContentNegotiationOptions()
	// Both bad Accept and bad Content-Type → 406 wins (Accept checked first).
	d := core.EvaluateContentNegotiation(strPtr("text/html"), strPtr("text/plain"), "POST", opts)
	if d.Status != core.StatusNotAcceptable {
		t.Fatalf("406 should win: %+v", d)
	}
}

func TestEvaluateNegotiationDeleteNotBodyCarrying(t *testing.T) {
	opts := core.DefaultContentNegotiationOptions()
	// DELETE is not in default BodyCarryingMethods.
	d := core.EvaluateContentNegotiation(nil, nil, "DELETE", opts)
	if d.Status != core.StatusOK {
		t.Fatalf("DELETE should skip content-type: %+v", d)
	}
}
