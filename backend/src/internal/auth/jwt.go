package auth

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const tokenDuration = 8 * time.Hour

// cookieNameForEnv returns the correct cookie name based on environment.
// In production (HTTPS), uses __Host- prefix which enforces:
//   Secure=true, Path=/, no Domain — prevents subdomain cookie theft.
// In local dev (HTTP, COOKIE_SECURE=false), uses a plain name because
//   browsers silently drop __Host- cookies on non-HTTPS origins.
func cookieNameForEnv() string {
	if os.Getenv("COOKIE_SECURE") == "false" {
		return "platform-token"
	}
	return "__Host-platform-token"
}

type Claims struct {
	GithubLogin string   `json:"github_login"`
	GithubID    int64    `json:"github_id"`
	Role        string   `json:"role"`
	Teams       []string `json:"teams"` // all team slugs user belongs to in the org
	jwt.RegisteredClaims
}

func GenerateJWT(login string, githubID int64, role string, teams []string) (string, error) {
	slog.Info("generating JWT", "login", login, "role", role, "team_count", len(teams))

	secret := []byte(os.Getenv("JWT_SECRET"))
	if len(secret) == 0 {
		return "", errors.New("JWT_SECRET is not set")
	}
	if teams == nil {
		teams = []string{}
	}

	expiresAt := time.Now().Add(tokenDuration)
	claims := Claims{
		GithubLogin: login,
		GithubID:    githubID,
		Role:        role,
		Teams:       teams,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   login,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(secret)
	if err != nil {
		slog.Error("JWT sign failed", "login", login, "error", err)
		return "", err
	}

	slog.Info("JWT issued", "login", login, "role", role, "expires_at", expiresAt.Format(time.RFC3339))
	return signed, nil
}

func ValidateJWT(tokenStr string) (*Claims, error) {
	secret := []byte(os.Getenv("JWT_SECRET"))
	if len(secret) == 0 {
		return nil, errors.New("JWT_SECRET is not set")
	}

	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return secret, nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// SetAuthCookie writes the JWT as an HttpOnly SameSite=Lax cookie.
// Set COOKIE_SECURE=false in local dev (HTTP only).
func SetAuthCookie(w http.ResponseWriter, token string) {
	secure := os.Getenv("COOKIE_SECURE") != "false"
	http.SetCookie(w, &http.Cookie{
		Name:     cookieNameForEnv(),
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(tokenDuration.Seconds()),
	})
}

// ClearAuthCookie expires the auth cookie immediately.
func ClearAuthCookie(w http.ResponseWriter) {
	secure := os.Getenv("COOKIE_SECURE") != "false"
	http.SetCookie(w, &http.Cookie{
		Name:     cookieNameForEnv(),
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// ExtractTokenFromRequest reads the JWT from (priority order):
//  1. HttpOnly cookie (platform-token / __Host-platform-token) — browsers
//  2. Authorization: Bearer <token>                             — API clients / CI
//  3. ?token= query param                                       — SSE only
func ExtractTokenFromRequest(r *http.Request) string {
	if c, err := r.Cookie(cookieNameForEnv()); err == nil && c.Value != "" {
		return c.Value
	}
	if h := r.Header.Get("Authorization"); h != "" {
		if strings.HasPrefix(h, "Bearer ") {
			return strings.TrimPrefix(h, "Bearer ")
		}
	}
	if isSSERequest(r) {
		if t := r.URL.Query().Get("token"); t != "" {
			return t
		}
	}
	return ""
}

func isSSERequest(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Accept"), "text/event-stream") ||
		strings.HasSuffix(r.URL.Path, "/stream")
}
