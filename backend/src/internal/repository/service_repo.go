package repository

import (
	"database/sql"
	"fmt"
	"strings"

	"src/src/internal/db"
)

// GetServices returns all services.
// Used by admin/operator roles via handler.GetServices.
func GetServices() ([]map[string]interface{}, error) {
	return getServicesFiltered(nil)
}

// GetServicesForTeams returns only services whose service_name is in the
// provided team slugs list. Used for developer and readonly roles.
func GetServicesForTeams(teams []string) ([]map[string]interface{}, error) {
	if len(teams) == 0 {
		return []map[string]interface{}{}, nil
	}
	return getServicesFiltered(teams)
}

func getServicesFiltered(teams []string) ([]map[string]interface{}, error) {
	query := `
		SELECT s.id, s.service_name, s.repo_name, s.owner_team,
		       s.runtime, s.cicd_type, s.template_version, s.deploy_type,
		       d.environment, d.status
		FROM services s
		LEFT JOIN deployments d ON s.id = d.service_id`

	args := []interface{}{}

	if len(teams) > 0 {
		placeholders := make([]string, len(teams))
		for i, t := range teams {
			placeholders[i] = "?"
			args = append(args, t)
		}
		query += fmt.Sprintf(
			" WHERE s.service_name IN (%s)",
			strings.Join(placeholders, ","),
		)
	}

	query += " ORDER BY s.created_at DESC"

	rows, err := db.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[int64]map[string]interface{})

	for rows.Next() {
		var (
			id                                                       int64
			env, status                                              sql.NullString
			serviceName, repoName, ownerTeam, runtime, cicd, tpl, deploy string
		)

		rows.Scan(
			&id, &serviceName, &repoName, &ownerTeam,
			&runtime, &cicd, &tpl, &deploy,
			&env, &status,
		)

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
	return services, nil
}

func UpdateDeployment(serviceName, env, status string) error {
	_, err := db.DB.Exec(`
		INSERT INTO deployments (service_id, environment, status)
		SELECT id, ?, ? FROM services WHERE service_name = ?
		ON DUPLICATE KEY UPDATE status = ?, updated_at = NOW()
	`, env, status, serviceName, status)
	return err
}
