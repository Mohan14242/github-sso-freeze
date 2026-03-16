package middleware

import (
	"fmt"
	"regexp"
	"strings"
)

// serviceNameRe: lowercase alphanumeric + hyphens, 2-63 chars,
// must start and end with alphanumeric. Matches DNS label rules.
var serviceNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9\-]{0,61}[a-z0-9]$`)

func ValidateServiceName(name string) error {
	if name == "" {
		return fmt.Errorf("service name is required")
	}
	if len(name) > 63 {
		return fmt.Errorf("service name must be 63 characters or fewer")
	}
	if strings.Contains(name, "..") || strings.ContainsAny(name, "/\\ \t\n") {
		return fmt.Errorf("service name contains invalid characters")
	}
	if !serviceNameRe.MatchString(name) {
		return fmt.Errorf("service name must be lowercase alphanumeric with hyphens (e.g. my-service), got: %q", name)
	}
	return nil
}

func ValidateEnvironment(env string) error {
	switch env {
	case "dev", "test", "prod":
		return nil
	default:
		return fmt.Errorf("invalid environment %q: must be dev, test, or prod", env)
	}
}

func SanitizeString(s string, maxLen int) (string, error) {
	s = strings.TrimSpace(s)
	if len(s) > maxLen {
		return "", fmt.Errorf("value exceeds maximum length of %d", maxLen)
	}
	return s, nil
}
