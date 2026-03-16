package handler

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"gopkg.in/yaml.v3"

	"src/src/internal/audit"
	"src/src/internal/auth"
	"src/src/internal/db"
	"src/src/internal/model"
)

func CreateService(w http.ResponseWriter, r *http.Request) {
	log.Println("[CREATE-SERVICE] Request received")

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ct := r.Header.Get("Content-Type")
	if !strings.Contains(ct, "yaml") {
		http.Error(w, "Content-Type must be application/x-yaml", http.StatusUnsupportedMediaType)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	var req model.CreateServiceRequest
	if err := yaml.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid YAML format", http.StatusBadRequest)
		return
	}

	if req.ServiceName == "" ||
		req.RepoName == "" ||
		req.Runtime == "" ||
		req.TemplateVersion == "" ||
		req.CICDType == "" ||
		len(req.Environments) == 0 {
		http.Error(w,
			"serviceName, repoName, ownerTeam, runtime, templateVersion, cicdType, environments are required",
			http.StatusBadRequest,
		)
		return
	}

	// AFTER — ownerTeam is set from the authenticated user's login
	requestedBy := "unknown"
	claims := auth.ClaimsFromContext(r.Context())
	if claims != nil {
		requestedBy = claims.GithubLogin
	}
	// Owner is always the submitting user — not taken from YAML
	req.OwnerTeam = requestedBy

	log.Printf("[CREATE-SERVICE] Request from user=%s service=%s runtime=%s templateVersion=%s",
		requestedBy, req.ServiceName, req.Runtime, req.TemplateVersion)

	// ── ✅ Step 1: Check template version exists and is not deprecated ──
	var templateStatus string
	err = db.DB.QueryRow(`
		SELECT status FROM template_versions
		WHERE runtime = ? AND version = ?
		LIMIT 1
	`, req.Runtime, req.TemplateVersion).Scan(&templateStatus)

	if err != nil {
		log.Printf("[CREATE-SERVICE][WARN] template not found runtime=%s version=%s err=%v",
			req.Runtime, req.TemplateVersion, err)

		audit.Log(r, audit.Entry{
			Actor:        requestedBy,
			Action:       "service_creation_request",
			ResourceType: "service",
			ResourceName: req.ServiceName,
			Status:       "rejected",
			Details: fmt.Sprintf(
				"Blocked — template runtime=%s version=%s not found in registry",
				req.Runtime, req.TemplateVersion,
			),
		})

		http.Error(w, fmt.Sprintf(
			"template version '%s' for runtime '%s' does not exist — please choose a valid template version",
			req.TemplateVersion, req.Runtime,
		), http.StatusUnprocessableEntity)
		return
	}

	if templateStatus == "deprecated" {
		log.Printf("[CREATE-SERVICE][WARN] template deprecated runtime=%s version=%s",
			req.Runtime, req.TemplateVersion)

		audit.Log(r, audit.Entry{
			Actor:        requestedBy,
			Action:       "service_creation_request",
			ResourceType: "service",
			ResourceName: req.ServiceName,
			Status:       "rejected",
			Details: fmt.Sprintf(
				"Blocked — template runtime=%s version=%s is deprecated, requestedBy=%s",
				req.Runtime, req.TemplateVersion, requestedBy,
			),
		})

		http.Error(w, fmt.Sprintf(
			"template version '%s' for runtime '%s' is deprecated and cannot be used for new services — please use an active version",
			req.TemplateVersion, req.Runtime,
		), http.StatusUnprocessableEntity)
		return
	}

	log.Printf("[CREATE-SERVICE] ✅ template valid runtime=%s version=%s status=%s",
		req.Runtime, req.TemplateVersion, templateStatus)

	// ── ✅ Step 2: Check for duplicate pending/approved request ──
	var existingStatus string
	err = db.DB.QueryRow(`
		SELECT status FROM service_creation_requests
		WHERE service_name = ? AND status IN ('pending','approved')
		LIMIT 1
	`, req.ServiceName).Scan(&existingStatus)

	if err == nil {
		log.Printf("[CREATE-SERVICE][WARN] Duplicate request service=%s status=%s",
			req.ServiceName, existingStatus)

		audit.Log(r, audit.Entry{
			Actor:        requestedBy,
			Action:       "service_creation_request",
			ResourceType: "service",
			ResourceName: req.ServiceName,
			Status:       "rejected",
			Details: fmt.Sprintf(
				"Blocked duplicate request — existing status=%s requestedBy=%s",
				existingStatus, requestedBy,
			),
		})

		http.Error(w,
			"a request for this service already exists with status: "+existingStatus,
			http.StatusConflict,
		)
		return
	}

	// ── ✅ Step 3: Save approval request ──
	result, err := db.DB.Exec(`
		INSERT INTO service_creation_requests
		  (service_name, requested_by, yaml_payload, status)
		VALUES (?, ?, ?, 'pending')
	`, req.ServiceName, requestedBy, string(body))

	if err != nil {
		log.Printf("[CREATE-SERVICE][ERROR] Failed to save request: %v", err)

		audit.Log(r, audit.Entry{
			Actor:        requestedBy,
			Action:       "service_creation_request",
			ResourceType: "service",
			ResourceName: req.ServiceName,
			Status:       "failed",
			Details: fmt.Sprintf(
				"DB insert failed requestedBy=%s runtime=%s version=%s",
				requestedBy, req.Runtime, req.TemplateVersion,
			),
		})

		http.Error(w, "failed to submit request", http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()
	log.Printf("[CREATE-SERVICE][SUCCESS] Request saved id=%d service=%s requestedBy=%s",
		id, req.ServiceName, requestedBy)

	// ── ✅ Step 4: Audit success ──
	audit.Log(r, audit.Entry{
		Actor:        requestedBy,
		Action:       "service_creation_request",
		ResourceType: "service",
		ResourceName: req.ServiceName,
		Status:       "pending",
		Details: fmt.Sprintf(
			"serviceName=%s runtime=%s templateVersion=%s cicdType=%s environments=%s requestedBy=%s",
			req.ServiceName,
			req.Runtime,
			req.TemplateVersion,
			req.CICDType,
			strings.Join(req.Environments, ","),
			requestedBy,
		),
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"status":"pending_approval","message":"Your service request has been submitted and is awaiting admin approval"}`))
}