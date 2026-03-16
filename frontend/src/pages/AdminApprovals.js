import { useEffect, useState, useCallback } from "react"
import { fetchProdApprovals, approveDeployment, rejectDeployment } from "../api/approvals"

const POLL_INTERVAL_MS = 8000

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function Avatar({ name }) {
  const initials = (name || "?").slice(0, 2).toUpperCase()
  const colors   = ["#6366f1", "#f59e0b", "#10b981", "#06b6d4", "#ec4899"]
  const color    = colors[(name?.charCodeAt(0) ?? 0) % colors.length]
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      background: color + "22", border: `1px solid ${color}44`,
      color, fontSize: 10, fontWeight: 800,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "monospace", flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}

function Spinner({ color = "#6366f1", size = 12 }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: "50%",
      border: `2px solid ${color}33`, borderTop: `2px solid ${color}`,
      display: "inline-block", animation: "spin 0.7s linear infinite", flexShrink: 0,
    }}/>
  )
}

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])

  const colors = {
    success: { bg: "#001a0f", border: "#10b98144", text: "#10b981" },
    error:   { bg: "#1a0a0a", border: "#e74c3c44", text: "#e74c3c" },
    info:    { bg: "#0f172a", border: "#33415544", text: "#94a3b8" },
  }
  const c = colors[type] ?? colors.info

  return (
    <div style={{
      position: "fixed", bottom: 28, right: 28, zIndex: 9000,
      padding: "12px 20px", borderRadius: 10,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      fontSize: 13, fontWeight: 600,
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      animation: "slideUp 0.2s ease both", maxWidth: 400,
    }}>
      {message}
    </div>
  )
}

function RejectModal({ onConfirm, onCancel }) {
  const [reason, setReason] = useState("")
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeUp 0.2s ease both",
    }}>
      <div style={{
        background: "#0a1020", border: "1px solid #e74c3c44",
        borderRadius: 16, padding: 28, width: 420,
        boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
      }}>
        <div style={{ fontSize: 20, marginBottom: 6 }}>⛔</div>
        <div style={{ fontWeight: 800, fontSize: 16, color: "#f1f5f9", marginBottom: 4 }}>
          Reject Deployment
        </div>
        <div style={{ fontSize: 12, color: "#475569", marginBottom: 18 }}>
          Provide a reason so the team knows what to fix.
        </div>
        <textarea
          autoFocus placeholder="e.g. Missing test coverage, config not reviewed…"
          value={reason} onChange={e => setReason(e.target.value)} rows={3}
          style={{
            width: "100%", boxSizing: "border-box",
            background: "#060b12", border: "1px solid #1e293b",
            borderRadius: 8, padding: "10px 12px",
            color: "#e2e8f0", fontSize: 12, fontFamily: "monospace",
            resize: "vertical", outline: "none",
          }}
          onFocus={e => e.target.style.borderColor = "#e74c3c55"}
          onBlur={e  => e.target.style.borderColor = "#1e293b"}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{
            padding: "8px 18px", borderRadius: 8,
            border: "1px solid #1e293b", background: "transparent",
            color: "#475569", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
            Cancel
          </button>
          <button onClick={() => onConfirm(reason)} style={{
            padding: "8px 18px", borderRadius: 8,
            border: "1px solid #e74c3c44", background: "#e74c3c22",
            color: "#e74c3c", fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>
            Confirm Reject
          </button>
        </div>
      </div>
    </div>
  )
}

function PendingCard({ approval, actionLoading, onApprove, onReject }) {
  const isLoading = actionLoading[approval.id]
  return (
    <div style={{
      background: "#0a1020", border: "1px solid #f59e0b22",
      borderRadius: 14, padding: 20,
      display: "flex", flexDirection: "column", gap: 14,
      position: "relative", overflow: "hidden",
      animation: "fadeUp 0.3s ease both",
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: "linear-gradient(90deg, #f59e0b, #f59e0b00)",
      }}/>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: "#1a1200", border: "1px solid #f59e0b33",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>🚀</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#f1f5f9" }}>{approval.serviceName}</div>
            <div style={{ fontSize: 11, color: "#475569", fontFamily: "monospace" }}>production environment</div>
          </div>
        </div>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 10px", borderRadius: 20,
          background: "#1a1200", border: "1px solid #f59e0b33",
          color: "#f59e0b", fontSize: 10, fontWeight: 700,
          letterSpacing: "0.1em", textTransform: "uppercase",
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#f59e0b", animation: "pulse 1.2s ease-in-out infinite" }}/>
          PENDING
        </span>
      </div>

      <div style={{
        background: "#060b12", border: "1px solid #0f172a",
        borderRadius: 8, padding: "10px 14px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar name={approval.requestedBy}/>
          <div>
            <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em" }}>Requested by</div>
            <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "monospace", fontWeight: 600 }}>
              {approval.requestedBy || "unknown"}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em" }}>Requested</div>
          <div style={{ fontSize: 12, color: "#475569", fontFamily: "monospace" }}>{timeAgo(approval.createdAt)}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onApprove(approval.id)} disabled={isLoading} style={{
          flex: 1, padding: "10px 0", borderRadius: 9,
          border: "1px solid #10b98144",
          background: isLoading ? "#10b98111" : "#10b98122",
          color: isLoading ? "#10b98155" : "#10b981",
          fontWeight: 700, fontSize: 12, cursor: isLoading ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
        }}
          onMouseEnter={e => { if (!isLoading) e.currentTarget.style.background = "#10b98133" }}
          onMouseLeave={e => { if (!isLoading) e.currentTarget.style.background = "#10b98122" }}
        >
          {isLoading ? <><Spinner color="#10b981"/> Processing…</> : <>✓ Approve Deployment</>}
        </button>
        <button onClick={() => onReject(approval.id)} disabled={isLoading} style={{
          flex: 1, padding: "10px 0", borderRadius: 9,
          border: "1px solid #e74c3c44", background: "#e74c3c11",
          color: isLoading ? "#e74c3c55" : "#e74c3c",
          fontWeight: 700, fontSize: 12, cursor: isLoading ? "not-allowed" : "pointer",
        }}
          onMouseEnter={e => { if (!isLoading) e.currentTarget.style.background = "#e74c3c22" }}
          onMouseLeave={e => { if (!isLoading) e.currentTarget.style.background = "#e74c3c11" }}
        >
          ✗ Reject
        </button>
      </div>
    </div>
  )
}

function HistoryRow({ approval }) {
  const isApproved = approval.status === "approved"
  const isRejected = approval.status === "rejected"
  const color = isApproved ? "#10b981" : isRejected ? "#e74c3c" : "#f59e0b"
  const icon  = isApproved ? "✓" : isRejected ? "✗" : "○"
  const label = isApproved ? "APPROVED" : isRejected ? "REJECTED" : "PENDING"

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "12px 16px", borderBottom: "1px solid #0a1020",
      transition: "background 0.15s",
    }}
      onMouseEnter={e => e.currentTarget.style.background = "#0a1020"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: color + "15", border: `1px solid ${color}33`,
        color, fontSize: 12, fontWeight: 800,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#e2e8f0", marginBottom: 2 }}>{approval.serviceName}</div>
        <div style={{ fontSize: 11, color: "#334155", fontFamily: "monospace" }}>
          prod · requested by {approval.requestedBy || "unknown"}
          {approval.reviewedBy ? ` · reviewed by ${approval.reviewedBy}` : ""}
        </div>
      </div>
      <span style={{
        padding: "3px 9px", borderRadius: 20,
        background: color + "15", border: `1px solid ${color}33`,
        color, fontSize: 10, fontWeight: 700,
        letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0,
      }}>
        {label}
      </span>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: "#475569", fontFamily: "monospace" }}>{timeAgo(approval.createdAt)}</div>
        {approval.approvedAt && (
          <div style={{ fontSize: 10, color: "#334155", fontFamily: "monospace" }}>
            actioned {timeAgo(approval.approvedAt)}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AdminApprovals() {
  const [approvals,     setApprovals]     = useState([])
  const [loading,       setLoading]       = useState(true)
  const [actionLoading, setActionLoading] = useState({})
  const [error,         setError]         = useState("")
  const [rejectTarget,  setRejectTarget]  = useState(null)
  const [lastUpdated,   setLastUpdated]   = useState(null)
  const [toast,         setToast]         = useState(null)

  const showToast = useCallback((message, type = "info") => setToast({ message, type }), [])

  const loadApprovals = useCallback(async () => {
    try {
      setError("")
      const data = await fetchProdApprovals()
      setApprovals(Array.isArray(data) ? data : [])
      setLastUpdated(new Date())
    } catch (err) {
      console.error("[approvals] load failed", err)
      setError("Failed to load approvals")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadApprovals()
    const iv = setInterval(loadApprovals, POLL_INTERVAL_MS)
    return () => clearInterval(iv)
  }, [loadApprovals])

  const handleApprove = async (id) => {
    setActionLoading(p => ({ ...p, [id]: true }))
    try {
      await approveDeployment(id)
      showToast("✅ Deployment approved and triggered", "success")
      await loadApprovals()
    } catch (err) {
      showToast(`❌ Failed to approve: ${err.message}`, "error")
    } finally {
      setActionLoading(p => ({ ...p, [id]: false }))
    }
  }

  const handleRejectConfirm = async (reason) => {
    const id = rejectTarget
    setRejectTarget(null)
    setActionLoading(p => ({ ...p, [id]: true }))
    try {
      await rejectDeployment(id, reason)
      showToast("Deployment rejected", "info")
      await loadApprovals()
    } catch (err) {
      showToast(`❌ Failed to reject: ${err.message}`, "error")
    } finally {
      setActionLoading(p => ({ ...p, [id]: false }))
    }
  }

  const pending = approvals.filter(a => a.status === "pending")
  const history = approvals.filter(a => a.status !== "pending")

  return (
    <div style={{
      minHeight: "100vh", background: "#060b12", color: "#e2e8f0",
      fontFamily: "'DM Sans', sans-serif", padding: "28px 32px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&display=swap');
        @keyframes spin    { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        @keyframes pulse   { 0%,100% { opacity:1 } 50% { opacity:0.3 } }
        @keyframes fadeUp  { from { opacity:0;transform:translateY(10px) } to { opacity:1;transform:translateY(0) } }
        @keyframes slideUp { from { transform:translateY(12px);opacity:0 } to { transform:translateY(0);opacity:1 } }
      `}</style>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)}/>}

      {rejectTarget && (
        <RejectModal
          onConfirm={handleRejectConfirm}
          onCancel={() => setRejectTarget(null)}
        />
      )}

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        marginBottom: 32, animation: "fadeUp 0.35s ease both",
      }}>
        <div>
          <div style={{
            fontSize: 10, color: "#6366f1", fontWeight: 700,
            letterSpacing: "0.2em", textTransform: "uppercase",
            fontFamily: "monospace", marginBottom: 6,
          }}>
            Admin Panel
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.02em" }}>
            Production Approvals
          </h1>
          <p style={{ margin: "5px 0 0", color: "#475569", fontSize: 13 }}>
            Review and action deployment requests for the production environment
          </p>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "7px 13px", borderRadius: 20,
          background: "#0a1020", border: "1px solid #0f172a",
          fontSize: 11, color: "#334155",
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%", background: "#10b981",
            display: "inline-block", animation: "pulse 2s ease-in-out infinite",
          }}/>
          Auto-refresh · {POLL_INTERVAL_MS / 1000}s
          {lastUpdated && <span style={{ color: "#1e293b", marginLeft: 3 }}>· {lastUpdated.toLocaleTimeString()}</span>}
        </div>
      </div>

      {/* Stats */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3,1fr)",
        gap: 10, marginBottom: 32, animation: "fadeUp 0.35s ease 0.05s both",
      }}>
        {[
          { label: "Pending",  value: pending.length,                                    color: "#f59e0b" },
          { label: "Approved", value: history.filter(a => a.status === "approved").length, color: "#10b981" },
          { label: "Rejected", value: history.filter(a => a.status === "rejected").length, color: "#e74c3c" },
        ].map(s => (
          <div key={s.label} style={{
            background: "#0a1020", border: "1px solid #0f172a",
            borderRadius: 10, padding: "13px 16px",
          }}>
            <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: "monospace" }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#334155", padding: "60px 0" }}>
          <Spinner color="#6366f1" size={16}/> Loading approvals…
        </div>
      )}

      {error && (
        <div style={{
          background: "#1a0a0a", border: "1px solid #e74c3c33",
          borderRadius: 10, padding: "12px 16px",
          color: "#e74c3c", fontSize: 13, marginBottom: 24,
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Pending */}
      {!loading && (
        <div style={{ animation: "fadeUp 0.35s ease 0.1s both" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{
              fontSize: 10, color: "#334155", fontWeight: 700,
              letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: "monospace",
            }}>
              Pending Approvals
            </div>
            {pending.length > 0 && (
              <span style={{
                padding: "2px 8px", borderRadius: 20,
                background: "#f59e0b22", border: "1px solid #f59e0b33",
                color: "#f59e0b", fontSize: 10, fontWeight: 700,
              }}>
                {pending.length}
              </span>
            )}
          </div>

          {pending.length === 0 ? (
            <div style={{
              background: "#0a1020", border: "1px solid #0f172a",
              borderRadius: 12, padding: "40px 0", textAlign: "center",
            }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
              <div style={{ color: "#334155", fontSize: 13, fontWeight: 600 }}>
                All clear — no pending approvals
              </div>
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
              gap: 14,
            }}>
              {pending.map(a => (
                <PendingCard
                  key={a.id} approval={a}
                  actionLoading={actionLoading}
                  onApprove={handleApprove}
                  onReject={id => setRejectTarget(id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {!loading && history.length > 0 && (
        <div style={{ marginTop: 36, animation: "fadeUp 0.35s ease 0.15s both" }}>
          <div style={{
            fontSize: 10, color: "#334155", fontWeight: 700,
            letterSpacing: "0.15em", textTransform: "uppercase",
            fontFamily: "monospace", marginBottom: 14,
          }}>
            Approval History
          </div>
          <div style={{ background: "#0a1020", border: "1px solid #0f172a", borderRadius: 12, overflow: "hidden" }}>
            {history.map(a => <HistoryRow key={a.id} approval={a}/>)}
          </div>
        </div>
      )}
    </div>
  )
}
