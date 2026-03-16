package handler

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"src/src/internal/audit"
	"src/src/internal/auth"
	"src/src/internal/db"
	"src/src/internal/middleware"
)

type FreezeStatus struct {
	ServiceName string  `json:"serviceName"`
	Environment string  `json:"environment"`
	Frozen      bool    `json:"frozen"`
	FrozenBy    *string `json:"frozenBy,omitempty"`
	FrozenAt    *string `json:"frozenAt,omitempty"`
	Reason      *string `json:"reason,omitempty"`
}

/* ── GET /services/{name}/freeze-status ── */

func GetFreezeStatus(w http.ResponseWriter, r *http.Request) {
	log := middleware.FromCtx(r.Context())

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	serviceName := extractFreezeServiceName(r.URL.Path)
	if err := middleware.ValidateServiceName(serviceName); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	log.Info("get freeze status", "service", serviceName)

	rows, err := db.DB.Query(`
		SELECT environment, frozen_by,
		       DATE_FORMAT(frozen_at, '%Y-%m-%dT%H:%i:%sZ'),
		       reason
		FROM deployment_freezes
		WHERE service_name = ?
	`, serviceName)
	if err != nil {
		log.Error("freeze status query failed", "error", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	frozen := map[string]FreezeStatus{}
	for rows.Next() {
		var env, by, at string
		var reason *string
		if err := rows.Scan(&env, &by, &at, &reason); err != nil {
			continue
		}
		frozen[env] = FreezeStatus{
			ServiceName: serviceName,
			Environment: env,
			Frozen:      true,
			FrozenBy:    &by,
			FrozenAt:    &at,
			Reason:      reason,
		}
	}

	// Fetch known environments for this service
	envRows, err := db.DB.Query(`
		SELECT DISTINCT d.environment
		FROM deployments d
		JOIN services s ON s.id = d.service_id
		WHERE s.service_name = ?
	`, serviceName)

	var result []FreezeStatus
	seen := map[string]bool{}

	if err == nil {
		defer envRows.Close()
		for envRows.Next() {
			var env string
			if envRows.Scan(&env) == nil {
				seen[env] = true
				if fs, ok := frozen[env]; ok {
					result = append(result, fs)
				} else {
					result = append(result, FreezeStatus{
						ServiceName: serviceName,
						Environment: env,
						Frozen:      false,
					})
				}
			}
		}
	}

	// Include any frozen envs not in the deployments table
	for env, fs := range frozen {
		if !seen[env] {
			result = append(result, fs)
		}
	}

	if result == nil {
		result = []FreezeStatus{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

/* ── POST /services/{name}/freeze ── */

func FreezeDeployment(w http.ResponseWriter, r *http.Request) {
	log := middleware.FromCtx(r.Context())

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	serviceName := extractFreezeServiceName(r.URL.Path)
	if err := middleware.ValidateServiceName(serviceName); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var body struct {
		Environment string `json:"environment"`
		Reason      string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if err := middleware.ValidateEnvironment(body.Environment); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	actor := "unknown"
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		actor = claims.GithubLogin
	}

	log.Info("freezing deployment", "service", serviceName, "env", body.Environment, "actor", actor)

	var reason interface{}
	if body.Reason != "" {
		reason = body.Reason
	}

	_, err := db.DB.Exec(`
		INSERT INTO deployment_freezes (service_name, environment, frozen_by, reason)
		VALUES (?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			frozen_by = VALUES(frozen_by),
			frozen_at = NOW(),
			reason    = VALUES(reason)
	`, serviceName, body.Environment, actor, reason)
	if err != nil {
		log.Error("freeze insert failed", "error", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	audit.Log(r, audit.Entry{
		Actor:        actor,
		Action:       "deployment_freeze",
		ResourceType: "deployment",
		ResourceName: serviceName,
		Environment:  body.Environment,
		Status:       "success",
		Details: fmt.Sprintf("frozen by=%s reason=%q", actor, body.Reason),
	})

	slog.Info("deployment frozen", "service", serviceName, "env", body.Environment, "actor", actor)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":     "deployment frozen",
		"serviceName": serviceName,
		"environment": body.Environment,
		"frozenBy":    actor,
	})
}

/* ── POST /services/{name}/unfreeze ── */

func UnfreezeDeployment(w http.ResponseWriter, r *http.Request) {
	log := middleware.FromCtx(r.Context())

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	serviceName := extractFreezeServiceName(r.URL.Path)
	if err := middleware.ValidateServiceName(serviceName); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var body struct {
		Environment string `json:"environment"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if err := middleware.ValidateEnvironment(body.Environment); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	actor := "unknown"
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		actor = claims.GithubLogin
	}

	log.Info("unfreezing deployment", "service", serviceName, "env", body.Environment, "actor", actor)

	res, err := db.DB.Exec(`
		DELETE FROM deployment_freezes WHERE service_name = ? AND environment = ?
	`, serviceName, body.Environment)
	if err != nil {
		log.Error("unfreeze delete failed", "error", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "deployment is not frozen for this environment", http.StatusNotFound)
		return
	}

	audit.Log(r, audit.Entry{
		Actor:        actor,
		Action:       "deployment_unfreeze",
		ResourceType: "deployment",
		ResourceName: serviceName,
		Environment:  body.Environment,
		Status:       "success",
		Details:      fmt.Sprintf("unfrozen by=%s", actor),
	})

	slog.Info("deployment unfrozen", "service", serviceName, "env", body.Environment, "actor", actor)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":     "deployment unfrozen",
		"serviceName": serviceName,
		"environment": body.Environment,
		"unfrozenBy":  actor,
	})
}

/* ── Helpers ── */

// extractFreezeServiceName pulls the service name from paths like:
// /services/{name}/freeze, /services/{name}/unfreeze, /services/{name}/freeze-status
func extractFreezeServiceName(path string) string {
	path = strings.TrimRight(path, "/")
	for _, suffix := range []string{"/freeze-status", "/freeze", "/unfreeze"} {
		if strings.HasSuffix(path, suffix) {
			path = strings.TrimSuffix(path, suffix)
			break
		}
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 2 {
		return ""
	}
	return parts[len(parts)-1]
}
