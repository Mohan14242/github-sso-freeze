package handler

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"src/src/internal/audit" // ← NEW
	"src/src/internal/auth"
	"src/src/internal/db"
	"src/src/internal/model"
	"src/src/internal/service"
	"gopkg.in/yaml.v3"
)

type ServiceCreationRequest struct {
	ID           int64      `json:"id"`
	ServiceName  string     `json:"serviceName"`
	RequestedBy  string     `json:"requestedBy"`
	YAMLPayload  string     `json:"yamlPayload"`
	Status       string     `json:"status"`
	ReviewedBy   *string    `json:"reviewedBy,omitempty"`
	RejectReason *string    `json:"rejectReason,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	ReviewedAt   *time.Time `json:"reviewedAt,omitempty"`
}

/* ===================== GET ALL REQUESTS ===================== */

func GetServiceCreationRequests(w http.ResponseWriter, r *http.Request) {
	log.Println("[SCR] Fetching service creation requests")

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	statusFilter := r.URL.Query().Get("status")

	query := `
		SELECT id, service_name, requested_by, yaml_payload,
		       status, reviewed_by, reject_reason, created_at, reviewed_at
		FROM service_creation_requests`

	args := []interface{}{}
	if statusFilter != "" {
		query += " WHERE status = ?"
		args = append(args, statusFilter)
	}
	query += " ORDER BY created_at DESC"

	rows, err := db.DB.Query(query, args...)
	if err != nil {
		log.Printf("[SCR][ERROR] DB query failed: %v", err)
		http.Error(w, "failed to fetch requests", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var requests []ServiceCreationRequest
	for rows.Next() {
		var req ServiceCreationRequest
		var reviewedBy, rejectReason sql.NullString
		var reviewedAt sql.NullTime

		if err := rows.Scan(
			&req.ID, &req.ServiceName, &req.RequestedBy, &req.YAMLPayload,
			&req.Status, &reviewedBy, &rejectReason, &req.CreatedAt, &reviewedAt,
		); err != nil {
			log.Printf("[SCR][ERROR] Row scan failed: %v", err)
			continue
		}

		if reviewedBy.Valid   { req.ReviewedBy   = &reviewedBy.String   }
		if rejectReason.Valid { req.RejectReason = &rejectReason.String }
		if reviewedAt.Valid   { req.ReviewedAt   = &reviewedAt.Time     }

		requests = append(requests, req)
	}

	if requests == nil {
		requests = []ServiceCreationRequest{}
	}

	log.Printf("[SCR] Returning %d requests (filter=%q)", len(requests), statusFilter)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(requests)
}

/* ===================== APPROVE ===================== */

func ApproveServiceCreation(w http.ResponseWriter, r *http.Request) {
	log.Println("[SCR][APPROVE] Request received")

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id, err := extractSCRID(r.URL.Path)
	if err != nil {
		http.Error(w, "invalid request id", http.StatusBadRequest)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())
	reviewedBy := "unknown"
	if claims != nil {
		reviewedBy = claims.GithubLogin
	}

	log.Printf("[SCR][APPROVE] id=%d reviewedBy=%s", id, reviewedBy)

	// Fetch the pending request
	// AFTER
	var yamlPayload, serviceName, requestedBy string
	err = db.DB.QueryRow(`
		SELECT yaml_payload, service_name, requested_by
		FROM service_creation_requests
		WHERE id = ? AND status = 'pending'
	`, id).Scan(&yamlPayload, &serviceName, &requestedBy)

	if err == sql.ErrNoRows {
		// ── audit: not found ──
		audit.Log(r, audit.Entry{
			Action:       "service_creation_approved",
			ResourceType: "service",
			ResourceName: fmt.Sprintf("id=%d", id),
			Status:       "failed",
			Details:      fmt.Sprintf("Approval failed — request not found or already processed by %s", reviewedBy),
		})
		http.Error(w, "request not found or already processed", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("[SCR][APPROVE][ERROR] DB error: %v", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	log.Printf("[SCR][APPROVE] Found request service=%s, triggering creation", serviceName)

	// Parse YAML
	// AFTER
	var req model.CreateServiceRequest
	if err := yaml.Unmarshal([]byte(yamlPayload), &req); err != nil {
		log.Printf("[SCR][APPROVE][ERROR] Failed to parse stored YAML: %v", err)

		// ── audit: yaml parse failure ──
		audit.Log(r, audit.Entry{
			Action:       "service_creation_approved",
			ResourceType: "service",
			ResourceName: serviceName,
			Status:       "failed",
			Details:      fmt.Sprintf("Stored YAML is invalid — reviewedBy=%s", reviewedBy),
		})

		http.Error(w, "stored yaml is invalid", http.StatusInternalServerError)
		return
	}

	req.OwnerTeam = requestedBy

	// Mark as approved BEFORE creating
	_, err = db.DB.Exec(`
		UPDATE service_creation_requests
		SET status='approved', reviewed_by=?, reviewed_at=NOW()
		WHERE id=?
	`, reviewedBy, id)
	if err != nil {
		log.Printf("[SCR][APPROVE][ERROR] Failed to update status: %v", err)
		http.Error(w, "failed to update request status", http.StatusInternalServerError)
		return
	}

	// Trigger actual service creation
	log.Printf("[SCR][APPROVE] Calling service.CreateService for service=%s", serviceName)

	repoURL, err := service.CreateService(req)
	if err != nil {
		// Roll back approval status so admin can retry
		db.DB.Exec(`
			UPDATE service_creation_requests
			SET status='pending', reviewed_by=NULL, reviewed_at=NULL
			WHERE id=?
		`, id)

		log.Printf("[SCR][APPROVE][ERROR] CreateService failed: %v", err)

		// ── audit: provisioning failed ──
		audit.Log(r, audit.Entry{
			Action:       "service_creation_approved",
			ResourceType: "service",
			ResourceName: serviceName,
			Status:       "failed",
			Details:      fmt.Sprintf("Provisioning failed — reviewedBy=%s error=%s", reviewedBy, err.Error()),
		})

		http.Error(w, "service creation failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[SCR][APPROVE][SUCCESS] Service created service=%s repoURL=%s", serviceName, repoURL)

	// ── audit: success ──
	audit.Log(r, audit.Entry{
		Action:       "service_creation_approved",
		ResourceType: "service",
		ResourceName: serviceName,
		Status:       "success",
		Details: fmt.Sprintf(
			"Service approved and provisioned — reviewedBy=%s repoURL=%s runtime=%s cicdType=%s",
			reviewedBy, repoURL, req.Runtime, req.CICDType,
		),
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "service approved and created successfully",
		"repoUrl": repoURL,
	})
}

/* ===================== REJECT ===================== */

func RejectServiceCreation(w http.ResponseWriter, r *http.Request) {
	log.Println("[SCR][REJECT] Request received")

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id, err := extractSCRID(r.URL.Path)
	if err != nil {
		http.Error(w, "invalid request id", http.StatusBadRequest)
		return
	}

	var body struct {
		Reason string `json:"reason"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	claims := auth.ClaimsFromContext(r.Context())
	reviewedBy := "unknown"
	if claims != nil {
		reviewedBy = claims.GithubLogin
	}

	log.Printf("[SCR][REJECT] id=%d reviewedBy=%s reason=%q", id, reviewedBy, body.Reason)

	// Fetch service name before updating (needed for audit)
	var serviceName string
	err = db.DB.QueryRow(`
		SELECT service_name FROM service_creation_requests
		WHERE id = ? AND status = 'pending'
	`, id).Scan(&serviceName)

	if err == sql.ErrNoRows {
		// ── audit: not found ──
		audit.Log(r, audit.Entry{
			Action:       "service_creation_rejected",
			ResourceType: "service",
			ResourceName: fmt.Sprintf("id=%d", id),
			Status:       "failed",
			Details:      fmt.Sprintf("Rejection failed — request not found or already processed by %s", reviewedBy),
		})
		http.Error(w, "request not found or already processed", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("[SCR][REJECT][ERROR] DB fetch failed: %v", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	res, err := db.DB.Exec(`
		UPDATE service_creation_requests
		SET status='rejected',
		    reviewed_by=?,
		    reviewed_at=NOW(),
		    reject_reason=?
		WHERE id=? AND status='pending'
	`, reviewedBy, nullableStr(body.Reason), id)

	if err != nil {
		log.Printf("[SCR][REJECT][ERROR] DB error: %v", err)

		// ── audit: db failure ──
		audit.Log(r, audit.Entry{
			Action:       "service_creation_rejected",
			ResourceType: "service",
			ResourceName: serviceName,
			Status:       "failed",
			Details:      fmt.Sprintf("DB update failed — reviewedBy=%s", reviewedBy),
		})

		http.Error(w, "failed to reject request", http.StatusInternalServerError)
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "request not found or already processed", http.StatusNotFound)
		return
	}

	log.Printf("[SCR][REJECT][SUCCESS] Request id=%d rejected by %s", id, reviewedBy)

	// ── audit: success ──
	reason := body.Reason
	if reason == "" {
		reason = "no reason provided"
	}
	audit.Log(r, audit.Entry{
		Action:       "service_creation_rejected",
		ResourceType: "service",
		ResourceName: serviceName,
		Status:       "rejected",
		Details:      fmt.Sprintf("Rejected by %s — reason: %s", reviewedBy, reason),
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"message":"service creation request rejected"}`))
}

/* ===================== HELPERS ===================== */

func extractSCRID(path string) (int64, error) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, p := range parts {
		if p == "approve" || p == "reject" {
			if i > 0 {
				return strconv.ParseInt(parts[i-1], 10, 64)
			}
		}
	}
	return 0, sql.ErrNoRows
}

func nullableStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
