package cicd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"log"
)

type JenkinsClient struct {
	BaseURL string
	User    string
	Token   string
}

// NewJenkinsClient creates a client from environment variables.
// Returns an error instead of calling log.Fatal so the caller can handle it gracefully.



func NewJenkinsClient() *JenkinsClient {
	baseURL := os.Getenv("JENKINS_URL")
	user    := os.Getenv("JENKINS_USER")
	token   := os.Getenv("JENKINS_API_TOKEN")

	log.Println("[JENKINS] Initializing Jenkins client")
	log.Println("[JENKINS] Raw JENKINS_URL:", baseURL)
	log.Println("[JENKINS] Jenkins user:", user)

	if baseURL == "" || user == "" || token == "" {
		log.Fatal("[JENKINS] Missing required Jenkins environment variables")
	}

	client := &JenkinsClient{
		BaseURL: strings.TrimRight(baseURL, "/"),
		User:    user,
		Token:   token,
	}

	log.Println("[JENKINS] Normalized BaseURL:", client.BaseURL)
	return client
}



// jenkinsHTTPClient has a 15-second timeout.
var jenkinsHTTPClient = &http.Client{Timeout: 15 * time.Second}

/* ── CSRF crumb (method on JenkinsClient) ── */

func (j *JenkinsClient) getCrumb() (string, string, error) {
	crumbURL := j.BaseURL + "/crumbIssuer/api/json"

	req, err := http.NewRequest("GET", crumbURL, nil)
	if err != nil {
		return "", "", fmt.Errorf("build crumb request: %w", err)
	}
	req.SetBasicAuth(j.User, j.Token)

	resp, err := jenkinsHTTPClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("crumb request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return "", "", fmt.Errorf("crumb fetch failed: %s — %s", resp.Status, string(body))
	}

	var data struct {
		Crumb             string `json:"crumb"`
		CrumbRequestField string `json:"crumbRequestField"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", "", fmt.Errorf("decode crumb: %w", err)
	}
	return data.CrumbRequestField, data.Crumb, nil
}

/* ── Standalone getCrumb for Trigger functions ── */

func getCrumb(client *http.Client, jenkinsURL, user, apiToken string) (string, string, error) {
	crumbURL := fmt.Sprintf("%s/crumbIssuer/api/json", jenkinsURL)
	req, err := http.NewRequest("GET", crumbURL, nil)
	if err != nil {
		return "", "", err
	}
	req.SetBasicAuth(user, apiToken)

	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return "", "", fmt.Errorf("crumb fetch failed: %s — %s", resp.Status, string(body))
	}

	var data struct {
		Crumb             string `json:"crumb"`
		CrumbRequestField string `json:"crumbRequestField"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", "", err
	}
	return data.CrumbRequestField, data.Crumb, nil
}

/* ── CreateMultibranchJob ── */

func (j *JenkinsClient) CreateMultibranchJob(jobName, repoURL, credentialsID, webhookToken string) error {
	slog.Info("creating Jenkins multibranch job", "job", jobName)

	configXML := fmt.Sprintf(`
<org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject plugin="workflow-multibranch">
  <description>Auto-created by Platform</description>
  <properties>
    <com.igalg.jenkins.plugins.mswt.trigger.ComputedFolderWebHookTrigger>
      <token>%s</token>
    </com.igalg.jenkins.plugins.mswt.trigger.ComputedFolderWebHookTrigger>
  </properties>
  <orphanedItemStrategy class="com.cloudbees.hudson.plugins.folder.computed.DefaultOrphanedItemStrategy">
    <pruneDeadBranches>true</pruneDeadBranches>
    <daysToKeep>-1</daysToKeep>
    <numToKeep>-1</numToKeep>
  </orphanedItemStrategy>
  <sources class="jenkins.branch.MultiBranchProject$BranchSourceList">
    <data>
      <jenkins.branch.BranchSource>
        <source class="org.jenkinsci.plugins.github_branch_source.GitHubSCMSource">
          <id>%s</id>
          <repoOwner>%s</repoOwner>
          <repository>%s</repository>
          <credentialsId>%s</credentialsId>
        </source>
      </jenkins.branch.BranchSource>
    </data>
  </sources>
  <factory class="org.jenkinsci.plugins.workflow.multibranch.WorkflowBranchProjectFactory">
    <scriptPath>Jenkinsfile</scriptPath>
  </factory>
</org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject>
`,
		webhookToken, jobName,
		extractOwner(repoURL), extractRepo(repoURL),
		credentialsID,
	)

	endpoint := fmt.Sprintf("%s/createItem?name=%s", j.BaseURL, url.QueryEscape(jobName))
	req, err := http.NewRequest("POST", endpoint, bytes.NewBufferString(configXML))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.SetBasicAuth(j.User, j.Token)
	req.Header.Set("Content-Type", "application/xml")

	resp, err := jenkinsHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("job creation request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("jenkins job creation failed: %s — %s", resp.Status, string(body))
	}

	slog.Info("Jenkins job created", "job", jobName)
	return nil
}

/* ── TriggerJenkinsDeploy ── */

func TriggerJenkinsDeploy(jobName, branch string, runID int64) error {
	jenkinsURL := strings.TrimRight(os.Getenv("JENKINS_URL"), "/")
	user       := os.Getenv("JENKINS_USER")
	apiToken   := os.Getenv("JENKINS_API_TOKEN")

	if jenkinsURL == "" || user == "" || apiToken == "" {
		return fmt.Errorf("Jenkins environment variables not set (JENKINS_URL, JENKINS_USER, JENKINS_API_TOKEN)")
	}

	slog.Info("triggering Jenkins deploy", "job", jobName, "branch", branch, "run_id", runID)

	client := &http.Client{Timeout: 15 * time.Second}

	crumbField, crumb, err := getCrumb(client, jenkinsURL, user, apiToken)
	if err != nil {
		return fmt.Errorf("get CSRF crumb: %w", err)
	}

	formData := url.Values{}
	formData.Set("ROLLBACK",         "false")
	formData.Set("ROLLBACK_VERSION", "")
	formData.Set("RUN_ID",           fmt.Sprintf("%d", runID))

	buildURL := fmt.Sprintf("%s/job/%s/job/%s/buildWithParameters",
		jenkinsURL, url.PathEscape(jobName), url.PathEscape(branch))

	req, err := http.NewRequest("POST", buildURL, strings.NewReader(formData.Encode()))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.SetBasicAuth(user, apiToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set(crumbField, crumb)

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("Jenkins trigger request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 201 && resp.StatusCode != 302 {
		return fmt.Errorf("Jenkins trigger failed: %s — %s", resp.Status, string(body))
	}

	slog.Info("Jenkins deploy triggered", "job", jobName, "branch", branch, "run_id", runID)
	return nil
}

/* ── TriggerJenkinsRollback ── */

func TriggerJenkinsRollback(serviceName, branch, version string, runID int64) error {
	jenkinsURL := strings.TrimRight(os.Getenv("JENKINS_URL"), "/")
	user       := os.Getenv("JENKINS_USER")
	apiToken   := os.Getenv("JENKINS_API_TOKEN")

	if jenkinsURL == "" || user == "" || apiToken == "" {
		return fmt.Errorf("Jenkins environment variables not set")
	}

	slog.Info("triggering Jenkins rollback", "service", serviceName, "branch", branch, "version", version, "run_id", runID)

	client := &http.Client{Timeout: 15 * time.Second}

	crumbField, crumb, err := getCrumb(client, jenkinsURL, user, apiToken)
	if err != nil {
		return fmt.Errorf("get CSRF crumb: %w", err)
	}

	formData := url.Values{}
	formData.Set("ROLLBACK",         "true")
	formData.Set("ROLLBACK_VERSION", version)
	formData.Set("RUN_ID",           fmt.Sprintf("%d", runID))

	buildURL := fmt.Sprintf("%s/job/%s/job/%s/buildWithParameters",
		jenkinsURL, url.PathEscape(serviceName), url.PathEscape(branch))

	req, err := http.NewRequest("POST", buildURL, strings.NewReader(formData.Encode()))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.SetBasicAuth(user, apiToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set(crumbField, crumb)

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("Jenkins rollback request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 201 && resp.StatusCode != 302 {
		return fmt.Errorf("Jenkins rollback failed: %s — %s", resp.Status, string(body))
	}

	slog.Info("Jenkins rollback triggered", "service", serviceName, "branch", branch, "version", version, "run_id", runID)
	return nil
}
