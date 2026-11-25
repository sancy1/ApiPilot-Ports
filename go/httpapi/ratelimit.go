package httpapi

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// RateLimiter is a fixed-window rate limiter keyed by client identity.
// Mirrors the ApiPilot rate-limit rejection surface (docs/rate-limiting.md):
// rejections emit a RATE_LIMITED envelope with an optional Retry-After
// header computed from the window reset — never invented.
type RateLimiter struct {
	mu      sync.Mutex
	windows map[string]*rateWindow
	limit   int
	window  time.Duration
	now     func() time.Time
}

type rateWindow struct {
	count   int
	resetAt time.Time
}

// NewRateLimiter creates a fixed-window limiter allowing `limit` requests
// per `window` per key.
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		windows: make(map[string]*rateWindow),
		limit:   limit,
		window:  window,
		now:     time.Now,
	}
}

// Allow reports whether the key may proceed. When false, retryAfter is the
// whole seconds until the window resets (>= 1).
func (l *RateLimiter) Allow(key string) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	w, ok := l.windows[key]
	if !ok || now.After(w.resetAt) || now.Equal(w.resetAt) {
		l.windows[key] = &rateWindow{count: 1, resetAt: now.Add(l.window)}
		return true, 0
	}
	if w.count >= l.limit {
		remaining := w.resetAt.Sub(now)
		secs := int(remaining.Seconds())
		if secs < 1 {
			secs = 1
		}
		return false, secs
	}
	w.count++
	return true, 0
}

// ClientKey extracts the rate-limit key from the request. Defaults to
// RemoteAddr host; falls back to "anonymous" when unavailable.
func ClientKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if host == "" {
		return "anonymous"
	}
	return host
}
