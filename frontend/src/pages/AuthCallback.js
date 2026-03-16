import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"

/**
 * AuthCallback — the backend sets an HttpOnly cookie and redirects here.
 * No token appears in the URL. We call login() which hits /auth/me to
 * hydrate user identity from the cookie, then navigate home.
 */
export default function AuthCallback() {
  const { login } = useAuth()
  const navigate  = useNavigate()
  const [msg, setMsg] = useState("Completing sign-in…")

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err    = params.get("error")
    if (err) {
      navigate(`/login?error=${err}`, { replace: true })
      return
    }

    login()
      .then(ok => {
        if (ok) {
          navigate("/", { replace: true })
        } else {
          setMsg("Authentication failed — redirecting…")
          setTimeout(() => navigate("/login?error=auth_failed", { replace: true }), 1500)
        }
      })
      .catch(() => navigate("/login?error=auth_failed", { replace: true }))
  }, [login, navigate])

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: "#060b12", color: "#64748b", gap: 16,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        border: "3px solid #1e293b", borderTop: "3px solid #6366f1",
        animation: "spin 0.8s linear infinite",
      }}/>
      <p style={{ fontSize: 14, margin: 0 }}>{msg}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
