package handler

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"src/src/internal/auth"
	"src/src/internal/db"
)

func GetServices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var rows *sql.Rows
	var err error

	// admin and operator see ALL services
	if claims.Role == "admin" || claims.Role == "operator" {
		slog.Info("fetching all services", "login", claims.GithubLogin, "role", claims.Role)
		rows, err = db.DB.Query(`
			SELECT s.id, s.service_name, s.repo_name, s.owner_team,
			       s.runtime, s.cicd_type, s.template_version, s.deploy_type,
			       d.environment, d.status
			FROM services s
			LEFT JOIN deployments d ON s.id = d.service_id
			ORDER BY s.created_at DESC
		`)
	} else {
		// developer and readonly: only see services whose name matches
		// one of their GitHub team slugs
		if len(claims.Teams) == 0 {
			slog.Info("user has no teams, returning empty list",
				"login", claims.GithubLogin, "role", claims.Role)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]interface{}{})
			return
		}

		// Build IN (?, ?, ...) placeholder
		placeholders := make([]string, len(claims.Teams))
		args := make([]interface{}, len(claims.Teams))
		for i, t := range claims.Teams {
			placeholders[i] = "?"
			args[i] = t
		}

		query := fmt.Sprintf(`
			SELECT s.id, s.service_name, s.repo_name, s.owner_team,
			       s.runtime, s.cicd_type, s.template_version, s.deploy_type,
			       d.environment, d.status
			FROM services s
			LEFT JOIN deployments d ON s.id = d.service_id
			WHERE s.service_name IN (%s)
			ORDER BY s.created_at DESC
		`, strings.Join(placeholders, ","))

		slog.Info("fetching scoped services",
			"login", claims.GithubLogin,
			"role",  claims.Role,
			"teams", claims.Teams,
		)
		rows, err = db.DB.Query(query, args...)
	}

	if err != nil {
		slog.Error("GetServices query failed", "error", err)
		http.Error(w, "failed to fetch services", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	// Aggregate rows — each service may have multiple deployment rows (one per env)
	result := make(map[int64]map[string]interface{})

	for rows.Next() {
		var (
			id                                                       int64
			serviceName, repoName, ownerTeam, runtime, cicd, tpl, deploy string
			env, status                                               sql.NullString
		)

		if err := rows.Scan(
			&id, &serviceName, &repoName, &ownerTeam,
			&runtime, &cicd, &tpl, &deploy,
			&env, &status,
		); err != nil {
			slog.Warn("GetServices row scan error", "error", err)
			continue
		}

		if _, ok := result[id]; !ok {
			result[id] = map[string]interface{}{
				"serviceName":     serviceName,
				"repoName":        repoName,
				"ownerTeam":       ownerTeam,
				"runtime":         runtime,
				"cicdType":        cicd,
				"templateVersion": tpl,
				"deployType":      deploy,
				"environments":    map[string]string{},
			}
		}

		if env.Valid {
			result[id]["environments"].(map[string]string)[env.String] = status.String
		}
	}

	services := make([]map[string]interface{}, 0, len(result))
	for _, v := range result {
		services = append(services, v)
	}

	slog.Info("GetServices response",
		"login", claims.GithubLogin,
		"role",  claims.Role,
		"count", len(services),
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(services)
}
