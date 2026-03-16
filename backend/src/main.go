package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"src/src/internal/audit"
	"src/src/internal/auth"
	"src/src/internal/db"
	"src/src/internal/handler"
	"src/src/internal/middleware"
	mw "src/src/internal/middleware"
)

/* ── Path extractors ─────────────────────────────────────────── */

func seg(path string, idx int) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if idx < len(parts) {
		return parts[idx]
	}
	return ""
}

func deployName(path string) string    { return seg(path, 1) } // /deploy-services/{name}/...
func rollbackName(path string) string  { return seg(path, 1) } // /rollback-services/{name}/...
func dashboardName(path string) string { return seg(path, 1) } // /servicesdashboard/{name}/...
func freezeName(path string) string    { return seg(path, 1) } // /services/{name}/...

/* ── Health checks ───────────────────────────────────────────── */

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	if err := db.DB.PingContext(r.Context()); err != nil {
		slog.Error("health: DB ping failed", "error", err)
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"status":"unhealthy","db":"unreachable"}`, http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

func handleReadyz(w http.ResponseWriter, r *http.Request) { handleHealthz(w, r) }

/* ── Template seed ───────────────────────────────────────────── */

func seedTemplateVersions() {
	root, err := handler.GetTemplateRoot()
	if err != nil {
		slog.Warn("templateRoot not found, skipping seed", "error", err)
		return
	}

	runtimeDirs, err := os.ReadDir(root)
	if err != nil {
		slog.Error("cannot read template_data", "error", err)
		return
	}

	count := 0
	for _, rd := range runtimeDirs {
		if !rd.IsDir() {
			continue
		}
		runtime := rd.Name()
		versionDirs, err := os.ReadDir(filepath.Join(root, runtime))
		if err != nil {
			continue
		}
		for _, vd := range versionDirs {
			if !vd.IsDir() {
				continue
			}
			version := vd.Name()
			_, err := db.DB.Exec(`
				INSERT IGNORE INTO template_versions
				  (name, version, runtime, description, status, created_by)
				VALUES (?, ?, ?, ?, 'active', 'system')
			`, runtime+"-service", version, runtime,
				fmt.Sprintf("Auto-seeded %s %s template", runtime, version))
			if err != nil {
				slog.Warn("template seed failed", "runtime", runtime, "version", version, "error", err)
			} else {
				count++
			}
		}
	}
	slog.Info("template seed complete", "count", count)
}

/* ── main ────────────────────────────────────────────────────── */

func main() {
	// 1. Structured JSON middleware
	middleware.Init()
	slog.Info("platform backend starting")

	// 2. Database with connection pool
	db.InitMySQL()
	if err := db.EnsureSchema(); err != nil {
		slog.Error("schema init failed", "error", err)
		os.Exit(1)
	}

	// 3. Seed templates
	seedTemplateVersions()

	// 4. Routes
	mux := http.NewServeMux()

	// ── Health / readiness — no auth, no rate limit ──
	mux.HandleFunc("/healthz", handleHealthz)
	mux.HandleFunc("/readyz",  handleReadyz)

	// ── Auth endpoints — strict rate limit ──
	authLimited := mw.RateLimit(mw.AuthLimiter)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/auth/login":
			auth.HandleLogin(w, r)
		case "/auth/callback":
			auth.HandleCallback(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	mux.Handle("/auth/login",    authLimited)
	mux.Handle("/auth/callback", authLimited)
	mux.HandleFunc("/auth/logout", auth.HandleLogout)
	mux.HandleFunc("/auth/me",    auth.Authenticate(auth.HandleMe))

	// ── All API routes — standard rate limit + middleware + CORS ──
	api := http.NewServeMux()

	// Services list — readonly+
	api.HandleFunc("/services", auth.RequireRole("readonly", handler.GetServices))

	// Service dashboard — scoped per service
	api.HandleFunc("/servicesdashboard/", auth.RequireServiceAccess(dashboardName, handler.GetServiceDashboard))

	// Artifacts and environments — readonly
	api.HandleFunc("/artifact-by-env/", auth.RequireRole("readonly", handler.GetServiceArtifacts))
	api.HandleFunc("/service-by-env/",  auth.RequireRole("readonly", handler.GetServiceEnvironments))

	// Freeze / unfreeze — split by method inside handler
	api.HandleFunc("/services/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch {
		case strings.HasSuffix(path, "/freeze-status") && r.Method == http.MethodGet:
			auth.RequireRole("readonly", handler.GetFreezeStatus)(w, r)
		case strings.HasSuffix(path, "/freeze") && r.Method == http.MethodPost:
			auth.RequireRole("operator", handler.FreezeDeployment)(w, r)
		case strings.HasSuffix(path, "/unfreeze") && r.Method == http.MethodPost:
			auth.RequireRole("operator", handler.UnfreezeDeployment)(w, r)
		default:
			http.NotFound(w, r)
		}
	})

	// Create service — developer+ (goes to approval queue)
	api.HandleFunc("/create-service", auth.RequireRole("developer", handler.CreateService))

	// Deploy — service-scoped (developer must be in team)
	api.HandleFunc("/deploy-services/", auth.RequireServiceAccess(deployName, handler.DeployServices))

	// Rollback — service-scoped
	api.HandleFunc("/rollback-services/", auth.RequireServiceAccess(rollbackName, handler.RollbackService))

	// Approvals — operator+
	api.HandleFunc("/approvals", auth.RequireRole("operator", handler.GetApprovals))
	api.HandleFunc("/approvals/", auth.RequireRole("operator", func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/approve"):
			handler.ApproveDeployment(w, r)
		case strings.HasSuffix(r.URL.Path, "/reject"):
			handler.RejectDeployment(w, r)
		case r.Method == http.MethodGet:
			handler.GetApprovalByID(w, r)
		default:
			http.NotFound(w, r)
		}
	}))

	// Pipeline — SSE uses its own rate limiter; stage updates use pipeline key
	api.HandleFunc("/pipeline/service/", auth.RequireRole("readonly", handler.GetLatestPipelineRun))
	api.HandleFunc("/pipeline/", func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/stream"):
			mw.RateLimit(mw.PipelineLimiter)(
				http.HandlerFunc(auth.RequireRole("readonly", handler.StreamPipelineRun)),
			).ServeHTTP(w, r)
		case strings.HasSuffix(r.URL.Path, "/stage"):
			auth.RequirePipelineKey(handler.UpdatePipelineStage)(w, r)
		default:
			auth.RequireRole("readonly", handler.GetPipelineRun)(w, r)
		}
	})

	// Artifacts — pipeline key for write
	api.HandleFunc("/artifacts", auth.RequirePipelineKey(handler.RegisterArtifact))

	// Stats — readonly
	api.HandleFunc("/stats", auth.RequireRole("readonly", handler.GetPlatformStats))

	// Audit logs — operator+
	api.HandleFunc("/audit-logs", auth.RequireRole("operator", audit.GetAuditLogs))

	// Service creation requests — operator approves/rejects
	api.HandleFunc("/service-creation-requests", auth.RequireRole("operator", handler.GetServiceCreationRequests))
	api.HandleFunc("/service-creation-requests/", auth.RequireRole("operator", func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/approve"):
			handler.ApproveServiceCreation(w, r)
		case strings.HasSuffix(r.URL.Path, "/reject"):
			handler.RejectServiceCreation(w, r)
		default:
			http.NotFound(w, r)
		}
	}))

	// Template versions — admin manages, readonly views
	api.HandleFunc("/template-versions/scan", auth.RequireRole("admin", handler.ScanTemplateVersions))
	api.HandleFunc("/template-versions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			auth.RequireRole("admin", handler.CreateTemplateVersion)(w, r)
			return
		}
		auth.RequireRole("readonly", handler.GetTemplateVersions)(w, r)
	})
	api.HandleFunc("/template-versions/", auth.RequireRole("admin", func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/deprecate"):
			handler.DeprecateTemplateVersion(w, r)
		case strings.HasSuffix(r.URL.Path, "/release"):
			handler.ReleaseTemplateVersion(w, r)
		default:
			http.NotFound(w, r)
		}
	}))

	// Wrap all API routes: rate limit → request ID / logging → CORS
	mux.Handle("/", mw.RateLimit(mw.APILimiter)(
		middleware.Middleware(
			auth.WithCORS(api),
		),
	))

	// 5. Server with timeouts
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second, // generous for SSE long-polling
		IdleTimeout:  120 * time.Second,
	}

	slog.Info("server listening", "port", port)
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("server exited", "error", err)
		os.Exit(1)
	}
}
