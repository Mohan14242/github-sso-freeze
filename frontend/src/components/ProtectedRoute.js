import { Navigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"

export default function ProtectedRoute({ minRole = "readonly", children }) {
  const { user, loading, hasRole } = useAuth()

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", background: "#060b12", gap: 12,
        color: "#475569", fontSize: 14,
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: "50%",
          border: "2px solid #1e293b", borderTop: "2px solid #6366f1",
          animation: "spin 0.8s linear infinite",
        }}/>
        Loading…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (!hasRole(minRole)) {
    return (
      <div style={{
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        minHeight: "100vh", background: "#060b12",
        color: "#e2e8f0", gap: 12, padding: 32, textAlign: "center",
      }}>
        <div style={{ fontSize: 48 }}>🚫</div>
        <h2 style={{ margin: 0, color: "#f1f5f9" }}>Access Denied</h2>
        <p style={{ color: "#475569", maxWidth: 380, margin: 0 }}>
          This page requires <strong style={{ color: "#e2e8f0" }}>{minRole}</strong> role or higher.
          Your current role is <strong style={{ color: "#e2e8f0" }}>{user.role}</strong>.
        </p>
        <p style={{ color: "#334155", fontSize: 13, margin: 0 }}>
          Contact your platform admin if you need access.
        </p>
      </div>
    )
  }

  return children
}
