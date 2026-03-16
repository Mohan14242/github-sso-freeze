import { useEffect, useState } from "react"
import { fetchServices } from "../api/services"
import { fetchServiceCreationRequests } from "../api/serviceCreationApi"
import { useNavigate } from "react-router-dom"

const PAGE_SIZE = 20

export default function ServicesList() {
  const [services, setServices] = useState([])
  const [pending,  setPending]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [page,     setPage]     = useState(1)
  const [search,   setSearch]   = useState("")
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  async function load() {
    try {
      setLoading(true)
      const [svcData, reqData] = await Promise.allSettled([
        fetchServices(),
        fetchServiceCreationRequests("pending"),
      ])
      setServices(
        svcData.status === "fulfilled" && Array.isArray(svcData.value) ? svcData.value : []
      )
      setPending(
        reqData.status === "fulfilled" && Array.isArray(reqData.value) ? reqData.value : []
      )
    } catch (err) {
      console.error("[ServicesList] load failed:", err)
    } finally {
      setLoading(false)
    }
  }

  // Filter by search
  const filtered = services.filter(svc =>
    !search ||
    svc.serviceName?.toLowerCase().includes(search.toLowerCase()) ||
    svc.ownerTeam?.toLowerCase().includes(search.toLowerCase()) ||
    svc.runtime?.toLowerCase().includes(search.toLowerCase())
  )

  // Paginate
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset page when search changes
  useEffect(() => { setPage(1) }, [search])

  if (loading) {
    return (
      <div style={{ padding: "40px 48px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#475569", fontSize: 14 }}>
          <div style={{
            width: 16, height: 16, borderRadius: "50%",
            border: "2px solid #1e293b", borderTop: "2px solid #6366f1",
            animation: "spin 1s linear infinite",
          }}/>
          Loading services…
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  const totalCount = services.length + pending.length

  return (
    <div style={{ padding: "40px 48px", maxWidth: 900 }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.15em",
          textTransform: "uppercase", color: "#6366f1", fontFamily: "monospace",
        }}>
          Infrastructure
        </span>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
          <h2 style={{ color: "#f1f5f9", margin: 0, fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700 }}>
            Services
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {pending.length > 0 && (
              <span style={{
                padding: "4px 12px", borderRadius: 20,
                background: "#1a1200", border: "1px solid #f59e0b44",
                color: "#f59e0b", fontSize: 12, fontWeight: 600,
              }}>
                ⏳ {pending.length} awaiting approval
              </span>
            )}
            <span style={{
              padding: "4px 12px", borderRadius: 20,
              background: "#1e293b", border: "1px solid #334155",
              color: "#64748b", fontSize: 12, fontFamily: "monospace",
            }}>
              {totalCount} total
            </span>
          </div>
        </div>
      </div>

      {/* Search */}
      {services.length > PAGE_SIZE && (
        <div style={{ position: "relative", marginBottom: 20 }}>
          <svg width="14" height="14" fill="none" stroke="#475569" strokeWidth="2" viewBox="0 0 24 24"
            style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }}>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search services…"
            style={{
              width: "100%", padding: "9px 12px 9px 32px", boxSizing: "border-box",
              background: "#0a0f1a", border: "1px solid #1e293b",
              borderRadius: 8, color: "#e2e8f0", fontSize: 13, outline: "none",
            }}
            onFocus={e => e.target.style.borderColor = "#6366f1"}
            onBlur={e  => e.target.style.borderColor = "#1e293b"}
          />
        </div>
      )}

      {/* Empty state */}
      {totalCount === 0 && (
        <div style={{
          textAlign: "center", padding: "80px 0",
          border: "1px dashed #1e293b", borderRadius: 12,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚙️</div>
          <p style={{ color: "#334155", fontSize: 14, margin: 0 }}>
            No services yet. Click "Create Service" to get started.
          </p>
        </div>
      )}

      {/* Pending approval cards */}
      {pending.map(req => (
        <div key={`pending-${req.id}`} style={{ position: "relative", marginBottom: 12 }}>
          <div style={{
            border: "1px solid #f59e0b44", background: "#0f172a",
            padding: "18px 20px", borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            filter: "blur(2.5px)", userSelect: "none", pointerEvents: "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, background: "#1e293b",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
              }}>⚙️</div>
              <div>
                <strong style={{ color: "#f1f5f9", fontSize: 15 }}>{req.serviceName}</strong>
                <div style={{ color: "#475569", fontSize: 12, marginTop: 2 }}>Requested by {req.requestedBy}</div>
              </div>
            </div>
          </div>
          <div style={{
            position: "absolute", inset: 0, borderRadius: 10,
            border: "1px solid #f59e0b55",
            background: "rgba(10, 15, 26, 0.82)",
            backdropFilter: "blur(3px)",
            display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 20, height: 20, borderRadius: "50%",
                border: "2px solid #f59e0b33", borderTop: "2px solid #f59e0b",
                animation: "spin 1s linear infinite",
              }}/>
              <div>
                <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15 }}>{req.serviceName}</div>
                <div style={{ color: "#f59e0b", fontSize: 12, marginTop: 2 }}>⏳ Waiting for admin approval</div>
              </div>
            </div>
            <span style={{
              padding: "3px 10px", borderRadius: 20,
              background: "#1a1200", border: "1px solid #f59e0b44",
              color: "#f59e0b", fontSize: 10, fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              ● Pending Approval
            </span>
          </div>
        </div>
      ))}

      {/* Ready services */}
      {paginated.map(svc => (
        <div key={svc.serviceName}
          onClick={() => navigate(`/services/${svc.serviceName}`)}
          style={{
            border: "1px solid #1e293b", background: "#0f172a",
            padding: "18px 20px", marginBottom: 12, borderRadius: 10,
            cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#6366f1"; e.currentTarget.style.background = "#0d1424" }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.background = "#0f172a" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, background: "#1e293b",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
            }}>⚙️</div>
            <div>
              <strong style={{ color: "#f1f5f9", fontSize: 15 }}>{svc.serviceName}</strong>
              <div style={{ color: "#475569", fontSize: 12, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                {svc.ownerTeam && <span>{svc.ownerTeam}</span>}
                {svc.runtime && (
                  <span style={{
                    padding: "1px 6px", borderRadius: 4,
                    background: "#1e293b", border: "1px solid #334155",
                    color: "#64748b", fontSize: 11, fontFamily: "monospace",
                  }}>
                    {svc.runtime}
                  </span>
                )}
                {svc.cicdType && (
                  <span style={{
                    padding: "1px 6px", borderRadius: 4,
                    background: "#1e293b", border: "1px solid #334155",
                    color: "#64748b", fontSize: 11, fontFamily: "monospace",
                  }}>
                    {svc.cicdType}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {svc.environments && Object.entries(svc.environments).map(([env, status]) => (
              <span key={env} style={{
                padding: "3px 8px", borderRadius: 4,
                fontSize: 11, fontFamily: "monospace", fontWeight: 600,
                background: status === "success" ? "#001a0f" : status === "failed" ? "#1a0a0a" : "#0f172a",
                border: `1px solid ${status === "success" ? "#10b98133" : status === "failed" ? "#e74c3c33" : "#1e293b"}`,
                color: status === "success" ? "#10b981" : status === "failed" ? "#e74c3c" : "#334155",
              }}>
                {env}
              </span>
            ))}
            <svg width="14" height="14" fill="none" stroke="#334155" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>
        </div>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 24 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: "7px 14px", borderRadius: 7,
              border: "1px solid #1e293b", background: "transparent",
              color: page === 1 ? "#334155" : "#64748b",
              cursor: page === 1 ? "not-allowed" : "pointer", fontSize: 13,
            }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 12, color: "#475569", fontFamily: "monospace" }}>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              padding: "7px 14px", borderRadius: 7,
              border: "1px solid #1e293b", background: "transparent",
              color: page === totalPages ? "#334155" : "#64748b",
              cursor: page === totalPages ? "not-allowed" : "pointer", fontSize: 13,
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
