package auth

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"src/src/internal/middleware"
)

type contextKey string

const claimsKey contextKey = "claims"

var rolePriority = map[string]int{
	"admin":     4,
	"operator":  3,
	"developer": 2,
	"readonly":  1,
}

func ClaimsFromContext(ctx context.Context) *Claims {
	c, _ := ctx.Value(claimsKey).(*Claims)
	return c
}

/* ── Authenticate ───────────────────────────────────────────── */

func Authenticate(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log := middleware.FromCtx(r.Context())

		token := ExtractTokenFromRequest(r)
		if token == "" {
			log.Warn("missing auth token", "path", r.URL.Path)
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"missing authorization token"}`, http.StatusUnauthorized)
			return
		}

		claims, err := ValidateJWT(token)
		if err != nil {
			log.Warn("invalid token", "path", r.URL.Path, "error", err)
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
			return
		}

		log.Debug("authenticated", "login", claims.GithubLogin, "role", claims.Role)
		ctx := context.WithValue(r.Context(), claimsKey, claims)
		next(w, r.WithContext(ctx))
	}
}

/* ── RequireRole ────────────────────────────────────────────── */

func RequireRole(minRole string, next http.HandlerFunc) http.HandlerFunc {
	return Authenticate(func(w http.ResponseWriter, r *http.Request) {
		log    := middleware.FromCtx(r.Context())
		claims := ClaimsFromContext(r.Context())

		if !hasPermission(claims.Role, minRole) {
			log.Warn("RBAC denied",
				"login",    claims.GithubLogin,
				"role",     claims.Role,
				"min_role", minRole,
				"path",     r.URL.Path,
			)
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"forbidden: insufficient permissions"}`, http.StatusForbidden)
			return
		}

		log.Debug("RBAC passed", "login", claims.GithubLogin, "role", claims.Role)
		next(w, r)
	})
}

/* ── RequireServiceAccess ───────────────────────────────────────
   admin / operator  → full access to any service
   developer         → full access only if in service team
   readonly          → GET only (no actions)
   ─────────────────────────────────────────────────────────────*/

func RequireServiceAccess(pathExtractor func(string) string, next http.HandlerFunc) http.HandlerFunc {
	return Authenticate(func(w http.ResponseWriter, r *http.Request) {
		log    := middleware.FromCtx(r.Context())
		claims := ClaimsFromContext(r.Context())

		if claims.Role == "admin" || claims.Role == "operator" {
			log.Debug("service access granted (platform-wide)", "login", claims.GithubLogin)
			next(w, r)
			return
		}

		if claims.Role == "readonly" {
			if r.Method == http.MethodGet {
				log.Debug("service access granted (readonly GET)", "login", claims.GithubLogin)
				next(w, r)
				return
			}
			log.Warn("readonly write attempt denied", "login", claims.GithubLogin, "method", r.Method)
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"forbidden: read-only users cannot perform actions"}`, http.StatusForbidden)
			return
		}

		serviceName := pathExtractor(r.URL.Path)
		if serviceName == "" {
			log.Error("could not extract service name from path", "path", r.URL.Path)
			http.Error(w, `{"error":"invalid path"}`, http.StatusBadRequest)
			return
		}

		if UserInTeam(claims.Teams, serviceName) {
			log.Debug("service access granted (team member)", "login", claims.GithubLogin, "service", serviceName)
			next(w, r)
			return
		}

		log.Warn("service access denied",
			"login",   claims.GithubLogin,
			"service", serviceName,
			"path",    r.URL.Path,
		)
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"error":"forbidden: you do not have access to this service"}`, http.StatusForbidden)
	})
}

/* ── RequirePipelineKey ─────────────────────────────────────── */

func RequirePipelineKey(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log := middleware.FromCtx(r.Context())

		expected := os.Getenv("PIPELINE_API_KEY")
		if expected == "" {
			log.Error("PIPELINE_API_KEY not configured")
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"pipeline authentication not configured"}`, http.StatusInternalServerError)
			return
		}

		provided := r.Header.Get("X-API-Key")
		if provided == "" {
			log.Warn("missing X-API-Key", "path", r.URL.Path)
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"missing X-API-Key header"}`, http.StatusUnauthorized)
			return
		}
		if provided != expected {
			log.Warn("invalid pipeline API key", "path", r.URL.Path)
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"invalid pipeline api key"}`, http.StatusUnauthorized)
			return
		}

		log.Debug("pipeline key valid", "path", r.URL.Path)
		next(w, r)
	}
}

/* ── WithCORS ───────────────────────────────────────────────── */

func WithCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		frontendURL := os.Getenv("FRONTEND_URL")
		if frontendURL == "" {
			slog.Warn("FRONTEND_URL not set — CORS will be broken")
		}

		w.Header().Set("Access-Control-Allow-Origin",      frontendURL)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods",     "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers",     "Authorization, Content-Type, X-API-Key")

		if isSSERequest(r) {
			w.Header().Set("X-Accel-Buffering", "no")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		start := time.Now()
		next.ServeHTTP(w, r)
		middleware.FromCtx(r.Context()).Debug("cors",
			"method",   r.Method,
			"path",     r.URL.Path,
			"duration", time.Since(start).Milliseconds(),
		)
	})
}

/* ── Helpers ────────────────────────────────────────────────── */

func hasPermission(userRole, requiredRole string) bool {
	return rolePriority[userRole] >= rolePriority[requiredRole]
}

// UserInTeam does case-insensitive team slug matching.
func UserInTeam(teams []string, serviceName string) bool {
	lower := strings.ToLower(serviceName)
	for _, t := range teams {
		if strings.ToLower(t) == lower {
			return true
		}
	}
	return false
}

// HasServiceAccess can be called from inside handlers for conditional logic.
func HasServiceAccess(claims *Claims, serviceName string) bool {
	if claims == nil {
		return false
	}
	if claims.Role == "admin" || claims.Role == "operator" {
		return true
	}
	return UserInTeam(claims.Teams, serviceName)
}
