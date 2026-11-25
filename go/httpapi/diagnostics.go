package httpapi

// Diagnostic is a non-fatal configuration observation. Mirrors the
// ApiPilot.Security.Diagnostics surface: reports configuration states that
// are legal but worth surfacing. Never exposes secrets.
type Diagnostic struct {
	Code    string
	Level   string // "info" | "warning"
	Message string
}

// Diagnostics inspects the resolved options and binding resolver and
// returns non-fatal diagnostics. Fatal conditions are enforced at
// construction time (New returns an error), not here.
func Diagnostics(opts Options, binding BindingResolver) []Diagnostic {
	var out []Diagnostic

	if opts.Csrf.Enabled && !bindingConfigured(binding) {
		out = append(out, Diagnostic{
			Code:    "csrf-no-binding",
			Level:   "warning",
			Message: "CSRF is enabled but no binding resolver extractors are configured; all bindings resolve to null and requests fail closed.",
		})
	}
	if opts.Origin.Enabled && len(opts.Origin.AllowedOrigins) == 0 {
		out = append(out, Diagnostic{
			Code:    "origin-empty-allowlist",
			Level:   "warning",
			Message: "Origin policy is enabled with an empty allowlist; all unsafe requests with an Origin header are rejected.",
		})
	}
	if opts.RateLimit.Enabled && opts.RateLimit.RequestsPerWindow <= 0 {
		out = append(out, Diagnostic{
			Code:    "rate-limit-default-limit",
			Level:   "info",
			Message: "Rate limiting is enabled with the default limit of 100 requests per window.",
		})
	}
	return out
}

// KeyRingDiagnostics inspects the CSRF key ring for multi-instance safety.
// Mirrors InstanceSafetyValidator + SharedKeyConfiguration (C#): a single
// key or missing keys are legal but risky at scale — every instance must
// share the same ring or tokens issued by one instance fail on another.
func KeyRingDiagnostics(ring *CsrfKeyRing, csrfEnabled bool) []Diagnostic {
	var out []Diagnostic
	if !csrfEnabled {
		return out
	}
	if ring == nil || len(ring.Keys) == 0 {
		out = append(out, Diagnostic{
			Code:    "csrf-keys-missing",
			Level:   "warning",
			Message: "CSRF is enabled but no key ring is configured; tokens cannot be issued or validated.",
		})
		return out
	}
	if len(ring.Keys) == 1 {
		out = append(out, Diagnostic{
			Code:    "csrf-single-key",
			Level:   "info",
			Message: "CSRF key ring has a single key; rotation requires downtime. Add a second key before rotating in multi-instance deployments.",
		})
	}
	if _, ok := ring.Keys[ring.ActiveKeyID]; !ok {
		out = append(out, Diagnostic{
			Code:    "csrf-active-key-missing",
			Level:   "warning",
			Message: "The CSRF active key ID is not present in the key ring; new tokens cannot be signed.",
		})
	}
	return out
}

func bindingConfigured(b BindingResolver) bool {
	d, ok := b.(*DefaultBindingResolver)
	if !ok || d == nil {
		return b != nil // custom resolvers are assumed configured
	}
	return d.SubjectExtractor != nil || d.SessionExtractor != nil || d.PreAuthSource != nil
}
