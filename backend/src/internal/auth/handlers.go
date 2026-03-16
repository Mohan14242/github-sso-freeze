package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"src/src/internal/audit"
	"src/src/internal/middleware"
)

const githubOrg = "mohans-organization"

// platformTeamRoles maps platform-level team slugs → role.
// Service-specific teams (e.g. "orders") are handled via Teams in the JWT.
var platformTeamRoles = map[string]string{
	"platform-admins":   "admin",
	"sre":               "operator",
	"developers":        "developer",
	"platform-readonly": "readonly",
}

// githubClient has a 10-second timeout so slow GitHub responses never hang the server.
var githubClient = &http.Client{Timeout: 10 * time.Second}

type githubUser struct {
	Login string `json:"login"`
	ID    int64  `json:"id"`
}

/* ── GET /auth/login ─────────────────────────────────────────── */

func HandleLogin(w http.ResponseWriter, r *http.Request) {
	log := middleware.FromCtx(r.Context())

	clientID    := os.Getenv("GITHUB_CLIENT_ID")
	redirectURI := os.Getenv("GITHUB_REDIRECT_URI")

	if clientID == "" || redirectURI == "" {
		log.Error("OAuth not configured", "client_id_present", clientID != "", "redirect_uri_present", redirectURI != "")
		http.Error(w, "OAuth not configured", http.StatusInternalServerError)
		return
	}

	url := fmt.Sprintf(
		"https://github.com/login/oauth/authorize?client_id=%s&redirect_uri=%s&scope=read:org",
		clientID, redirectURI,
	)
	log.Info("redirecting to GitHub OAuth")
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

/* ── GET /auth/callback ──────────────────────────────────────── */

func HandleCallback(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	log   := middleware.FromCtx(r.Context())
	log.Info("OAuth callback received")

	code := r.URL.Query().Get("code")
	if code == "" {
		log.Warn("no code param in callback")
		redirectError(w, r, "oauth_failed")
		return
	}

	// Step 1: code → access token
	accessToken, err := exchangeCode(r.Context(), code)
	if err != nil {
		log.Error("code exchange failed", "error", err)
		redirectError(w, r, "oauth_failed")
		return
	}

	// Step 2: fetch user identity
	user, err := getGithubUser(r.Context(), accessToken)
	if err != nil {
		log.Error("GitHub /user failed", "error", err)
		redirectError(w, r, "user_fetch_failed")
		return
	}
	log = log.With("login", user.Login, "github_id", user.ID)
	log.Info("GitHub user resolved")

	// Steps 3, 4, 4b run concurrently to cut login latency:
	//   - org membership check
	//   - platform role determination (all platform team checks run in parallel)
	//   - all-teams fetch (for service-scoped permissions)
	type memberResult struct {
		ok  bool
		err error
	}
	type roleResult struct {
		role string
		err  error
	}
	type teamsResult struct {
		teams []string
		err   error
	}

	memberCh := make(chan memberResult, 1)
	roleCh   := make(chan roleResult, 1)
	teamsCh  := make(chan teamsResult, 1)

	go func() {
		ok, err := checkOrgMembership(r.Context(), accessToken, user.Login)
		memberCh <- memberResult{ok, err}
	}()
	go func() {
		role, err := determineRole(r.Context(), accessToken, user.Login)
		roleCh <- roleResult{role, err}
	}()
	go func() {
		teams, err := fetchAllUserTeams(r.Context(), accessToken)
		teamsCh <- teamsResult{teams, err}
	}()

	mr := <-memberCh
	rr := <-roleCh
	tr := <-teamsCh

	// Handle membership
	if mr.err != nil {
		log.Error("org membership check failed", "error", mr.err)
		audit.Log(r, audit.Entry{
			Action: "login", ResourceType: "auth", ResourceName: user.Login,
			Status: "failed", Details: "org membership check error: " + mr.err.Error(),
		})
		redirectError(w, r, "org_check_failed")
		return
	}
	if !mr.ok {
		log.Warn("user not in org", "org", githubOrg)
		audit.Log(r, audit.Entry{
			Action: "login", ResourceType: "auth", ResourceName: user.Login,
			Status: "rejected", Details: fmt.Sprintf("not a member of org=%s", githubOrg),
		})
		redirectError(w, r, "not_org_member")
		return
	}

	// Handle role
	if rr.err != nil {
		log.Error("role determination failed", "error", rr.err)
		redirectError(w, r, "role_check_failed")
		return
	}
	if rr.role == "" {
		log.Warn("no platform role assigned")
		audit.Log(r, audit.Entry{
			Action: "login", ResourceType: "auth", ResourceName: user.Login,
			Status: "rejected", Details: "no team role assigned",
		})
		redirectError(w, r, "no_role_assigned")
		return
	}

	// Teams are non-fatal — warn and continue with empty list
	allTeams := tr.teams
	if tr.err != nil {
		log.Warn("could not fetch all teams, using empty list", "error", tr.err)
		allTeams = []string{}
	}

	log.Info("login resolved", "role", rr.role, "team_count", len(allTeams))

	// Issue JWT
	jwtToken, err := GenerateJWT(user.Login, user.ID, rr.role, allTeams)
	if err != nil {
		log.Error("JWT generation failed", "error", err)
		redirectError(w, r, "token_failed")
		return
	}

	// Set HttpOnly cookie — token NEVER touches the URL or JS
	SetAuthCookie(w, jwtToken)

	audit.Log(r, audit.Entry{
		Action: "login", ResourceType: "auth", ResourceName: user.Login,
		Status: "success",
		Details: fmt.Sprintf("role=%s teams=%d duration_ms=%d",
			rr.role, len(allTeams), time.Since(start).Milliseconds()),
	})

	// Redirect to frontend — no token in URL
	frontendURL := strings.TrimRight(os.Getenv("FRONTEND_URL"), "/")
	http.Redirect(w, r, frontendURL+"/auth/callback", http.StatusTemporaryRedirect)
}

/* ── GET /auth/me ────────────────────────────────────────────── */

func HandleMe(w http.ResponseWriter, r *http.Request) {
	log    := middleware.FromCtx(r.Context())
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		log.Warn("no claims in context for /auth/me")
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	log.Info("identity served", "login", claims.GithubLogin, "role", claims.Role)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"login":     claims.GithubLogin,
		"role":      claims.Role,
		"githubId":  claims.GithubID,
		"teams":     claims.Teams,
		"expiresAt": claims.ExpiresAt.Time.Unix(),
	})
}

/* ── POST /auth/logout ───────────────────────────────────────── */

func HandleLogout(w http.ResponseWriter, r *http.Request) {
	log := middleware.FromCtx(r.Context())
	log.Info("logout", "remote_addr", r.RemoteAddr)
	ClearAuthCookie(w)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "logged out"})
}

/* ── Private helpers ─────────────────────────────────────────── */

func exchangeCode(ctx context.Context, code string) (string, error) {
	payload := fmt.Sprintf("client_id=%s&client_secret=%s&code=%s",
		os.Getenv("GITHUB_CLIENT_ID"), os.Getenv("GITHUB_CLIENT_SECRET"), code)

	req, err := http.NewRequestWithContext(ctx, "POST",
		"https://github.com/login/oauth/access_token", strings.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := githubClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("token exchange: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if result.Error != "" {
		return "", fmt.Errorf("github oauth: %s — %s", result.Error, result.ErrorDesc)
	}
	return result.AccessToken, nil
}

func getGithubUser(ctx context.Context, token string) (*githubUser, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "platform-backend")

	resp, err := githubClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github /user status %s", resp.Status)
	}
	var u githubUser
	json.NewDecoder(resp.Body).Decode(&u)
	if u.Login == "" {
		return nil, fmt.Errorf("empty github login")
	}
	return &u, nil
}

func checkOrgMembership(ctx context.Context, token, login string) (bool, error) {
	url := fmt.Sprintf("https://api.github.com/user/memberships/orgs/%s", githubOrg)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "platform-backend")

	resp, err := githubClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, nil
	}
	var result struct{ State string `json:"state"` }
	json.NewDecoder(resp.Body).Decode(&result)
	return result.State == "active", nil
}

// determineRole checks all platform teams concurrently and picks the highest role.
func determineRole(ctx context.Context, token, login string) (string, error) {
	type res struct {
		role     string
		priority int
	}
	ch := make(chan res, len(platformTeamRoles))
	var wg sync.WaitGroup

	for team, role := range platformTeamRoles {
		wg.Add(1)
		go func(team, role string) {
			defer wg.Done()
			ok, err := checkTeamMembership(ctx, token, team, login)
			if err != nil {
				slog.Warn("team membership check error", "team", team, "error", err)
				ch <- res{}
				return
			}
			if ok {
				ch <- res{role: role, priority: rolePriority[role]}
			} else {
				ch <- res{}
			}
		}(team, role)
	}

	go func() { wg.Wait(); close(ch) }()

	bestRole, bestPriority := "", 0
	for r := range ch {
		if r.role != "" && r.priority > bestPriority {
			bestRole, bestPriority = r.role, r.priority
		}
	}
	return bestRole, nil
}

// fetchAllUserTeams returns all team slugs the user belongs to in our org.
func fetchAllUserTeams(ctx context.Context, token string) ([]string, error) {
	var slugs []string
	page := 1
	for {
		url := fmt.Sprintf("https://api.github.com/user/teams?per_page=100&page=%d", page)
		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "token "+token)
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("User-Agent", "platform-backend")

		resp, err := githubClient.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			slog.Warn("/user/teams non-200", "status", resp.Status)
			return []string{}, nil
		}

		var teams []struct {
			Slug string `json:"slug"`
			Org  struct {
				Login string `json:"login"`
			} `json:"organization"`
		}
		json.NewDecoder(resp.Body).Decode(&teams)
		resp.Body.Close()

		if len(teams) == 0 {
			break
		}
		for _, t := range teams {
			if strings.EqualFold(t.Org.Login, githubOrg) {
				slugs = append(slugs, t.Slug)
			}
		}
		if len(teams) < 100 {
			break
		}
		page++
	}
	return slugs, nil
}

func checkTeamMembership(ctx context.Context, token, team, login string) (bool, error) {
	url := fmt.Sprintf("https://api.github.com/orgs/%s/teams/%s/memberships/%s", githubOrg, team, login)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "platform-backend")

	resp, err := githubClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, nil
	}
	var result struct{ State string `json:"state"` }
	json.NewDecoder(resp.Body).Decode(&result)
	return result.State == "active", nil
}

func redirectError(w http.ResponseWriter, r *http.Request, reason string) {
	frontendURL := strings.TrimRight(os.Getenv("FRONTEND_URL"), "/")
	http.Redirect(w, r, frontendURL+"/login?error="+reason, http.StatusTemporaryRedirect)
}
