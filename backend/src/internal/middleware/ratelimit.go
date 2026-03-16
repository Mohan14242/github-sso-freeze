package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

)

type tokenBucket struct {
	mu       sync.Mutex
	tokens   float64
	lastFill time.Time
}

func (b *tokenBucket) allow(rate, burst float64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	b.tokens += now.Sub(b.lastFill).Seconds() * rate
	b.lastFill = now
	if b.tokens > burst {
		b.tokens = burst
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// Limiter holds per-IP token buckets.
type Limiter struct {
	mu      sync.RWMutex
	buckets map[string]*tokenBucket
	rate    float64
	burst   float64
}

func NewLimiter(ratePerSec, burst float64) *Limiter {
	l := &Limiter{
		buckets: make(map[string]*tokenBucket),
		rate:    ratePerSec,
		burst:   burst,
	}
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			l.evict()
		}
	}()
	return l
}

func (l *Limiter) evict() {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := time.Now().Add(-5 * time.Minute)
	for k, b := range l.buckets {
		b.mu.Lock()
		idle := b.lastFill.Before(cutoff)
		b.mu.Unlock()
		if idle {
			delete(l.buckets, k)
		}
	}
}

func (l *Limiter) getBucket(key string) *tokenBucket {
	l.mu.RLock()
	b, ok := l.buckets[key]
	l.mu.RUnlock()
	if ok {
		return b
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if b, ok = l.buckets[key]; ok {
		return b
	}
	b = &tokenBucket{tokens: l.burst, lastFill: time.Now()}
	l.buckets[key] = b
	return b
}

func (l *Limiter) Allow(key string) bool {
	return l.getBucket(key).allow(l.rate, l.burst)
}

func clientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
		if i := strings.Index(ip, ","); i >= 0 {
			return strings.TrimSpace(ip[:i])
		}
		return strings.TrimSpace(ip)
	}
	if i := strings.LastIndex(r.RemoteAddr, ":"); i >= 0 {
		return r.RemoteAddr[:i]
	}
	return r.RemoteAddr
}

// RateLimit wraps a handler with per-IP rate limiting.
func RateLimit(l *Limiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := clientIP(r)
			if !l.Allow(ip) {
				FromCtx(r.Context()).Warn("rate limit exceeded", "ip", ip, "path", r.URL.Path)
				w.Header().Set("Retry-After", "1")
				w.Header().Set("Content-Type", "application/json")
				http.Error(w, `{"error":"too many requests — please slow down"}`, http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Pre-built limiters for different tiers.
var (
	AuthLimiter     = NewLimiter(5, 10)    // /auth/login, /auth/callback
	APILimiter      = NewLimiter(30, 60)   // all authenticated API calls
	PipelineLimiter = NewLimiter(100, 200) // CI/CD callbacks
)
