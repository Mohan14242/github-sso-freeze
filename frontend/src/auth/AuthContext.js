import { createContext, useContext, useState, useCallback, useEffect } from "react"

const AuthContext = createContext(null)

const ROLE_PRIORITY = { admin: 4, operator: 3, developer: 2, readonly: 1 }

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)

  // JWT lives in an HttpOnly cookie — JS cannot read it.
  // Hydrate identity on mount by calling /auth/me (cookie sent automatically).
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setUser({ login: data.login, role: data.role, teams: data.teams ?? [] })
      })
      .catch(err => console.warn("[auth] /auth/me failed:", err))
      .finally(() => setLoading(false))
  }, [])

  // Called by AuthCallback after OAuth redirect — cookie already set, just re-hydrate.
  const login = useCallback(async () => {
    const res = await fetch("/api/auth/me", { credentials: "include" })
    if (!res.ok) return false
    const data = await res.json()
    setUser({ login: data.login, role: data.role, teams: data.teams ?? [] })
    return true
  }, [])

  // Clears the HttpOnly cookie server-side.
  const logout = useCallback(async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }) } catch {}
    setUser(null)
    window.location.href = "/login"
  }, [])

  const hasRole = useCallback((minRole) => {
    if (!user) return false
    return (ROLE_PRIORITY[user.role] ?? 0) >= (ROLE_PRIORITY[minRole] ?? 0)
  }, [user])

  /**
   * canActOnService(serviceName) — can user deploy/rollback/freeze this service?
   *   admin / operator → always true (platform-wide)
   *   developer        → true only if serviceName is in their teams list
   *   readonly         → always false
   */
  const canActOnService = useCallback((serviceName) => {
    if (!user) return false
    if (user.role === "admin" || user.role === "operator") return true
    if (user.role === "readonly") return false
    const lower = (serviceName || "").toLowerCase()
    return (user.teams || []).some(t => t.toLowerCase() === lower)
  }, [user])

  return (
    <AuthContext.Provider value={{
      user, loading, login, logout, hasRole, canActOnService,
      isReadOnly:     user?.role === "readonly",
      isPlatformWide: user?.role === "admin" || user?.role === "operator",
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>")
  return ctx
}
