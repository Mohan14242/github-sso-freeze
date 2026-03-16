import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"

const ERROR_MESSAGES = {
  not_org_member:   "You are not a member of the required GitHub organization (mohans-organization).",
  no_role_assigned: "Your account has no team role assigned. Contact your platform admin.",
  oauth_failed:     "GitHub OAuth failed. Please try again.",
  org_check_failed: "Could not verify your organization membership. Try again.",
  role_check_failed:"Could not determine your role. Try again.",
  token_failed:     "Failed to issue a session token. Try again.",
  auth_failed:      "Authentication failed. Please try signing in again.",
}

export default function LoginPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const error    = new URLSearchParams(window.location.search).get("error")

  // Already logged in → go home
  useEffect(() => {
    if (user) navigate("/", { replace: true })
  }, [user, navigate])

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: "#060b12",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
      `}</style>

      <div style={{
        width: 420, padding: "48px 40px",
        background: "#0a0f1a",
        border: "1px solid #1e293b",
        borderRadius: 16,
        boxShadow: "0 32px 80px rgba(0,0,0,0.5)",
        textAlign: "center",
      }}>
        {/* Logo */}
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>

        <div style={{
          fontSize: 10, color: "#6366f1", fontWeight: 700,
          letterSpacing: "0.2em", textTransform: "uppercase",
          fontFamily: "monospace", marginBottom: 8,
        }}>
          Internal Developer Platform
        </div>

        <h1 style={{
          margin: "0 0 8px", fontSize: 24, fontWeight: 800,
          color: "#f1f5f9", letterSpacing: "-0.02em",
        }}>
          Sign in
        </h1>

        <p style={{ color: "#475569", fontSize: 13, margin: "0 0 32px", lineHeight: 1.6 }}>
          You must be a member of{" "}
          <strong style={{ color: "#64748b" }}>mohans-organization</strong>{" "}
          on GitHub to access this platform.
        </p>

        {/* Error banner */}
        {error && (
          <div style={{
            padding: "12px 16px", borderRadius: 8,
            background: "#1a0a0a", border: "1px solid #e74c3c44",
            color: "#e74c3c", fontSize: 13, marginBottom: 24,
            textAlign: "left", lineHeight: 1.5,
          }}>
            ⚠️ {ERROR_MESSAGES[error] ?? "Authentication failed. Please try again."}
          </div>
        )}

        {/* GitHub OAuth button — redirects server-side, sets HttpOnly cookie */}
        <a
          href="/api/auth/login"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            gap: 10, width: "100%", padding: "13px 0",
            background: "#24292e",
            color: "#fff", textDecoration: "none",
            borderRadius: 9, fontSize: 15, fontWeight: 700,
            letterSpacing: 0.3, boxSizing: "border-box",
            transition: "background 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "#2f363d"}
          onMouseLeave={e => e.currentTarget.style.background = "#24292e"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          Sign in with GitHub
        </a>

        <p style={{ color: "#1e293b", fontSize: 12, margin: "24px 0 0" }}>
          Your session is secured with an HttpOnly cookie.
          No tokens are stored in the browser.
        </p>
      </div>
    </div>
  )
}
