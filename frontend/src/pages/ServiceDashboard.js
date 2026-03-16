import { useEffect, useState, useRef, useCallback } from "react"
import { useParams, Link } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import { fetchServiceDashboard, deployService } from "../api/services"
import { fetchLatestPipelineRun } from "../api/pipelineApi"
import { fetchApprovalById, fetchProdApprovals } from "../api/approvals"
import { fetchFreezeStatus, freezeDeployment, unfreezeDeployment } from "../api/freezeapi"
import PipelineView from "../components/PipelineView"
import ServiceCard from "../components/ServiceCard"

const DEFAULT_ENVS     = ["dev", "test", "prod"]
const POLL_INTERVAL_MS = 5000
const APPROVAL_POLL_MS = 3000

const ENV_CFG = {
  dev:  { color: "#6366f1", bg: "#0d0f2e", label: "Development", icon: "⚗️"  },
  test: { color: "#f59e0b", bg: "#1a1200", label: "Testing",     icon: "🧪"  },
  prod: { color: "#10b981", bg: "#001a0f", label: "Production",  icon: "🚀"  },
}

const STATUS_CFG = {
  deployed:     { color: "#10b981", bg: "#10b98115", label: "Deployed",     dot: true  },
  not_deployed: { color: "#334155", bg: "#33415515", label: "Not Deployed", dot: false },
  deploying:    { color: "#f59e0b", bg: "#f59e0b15", label: "Deploying",    dot: true  },
  failed:       { color: "#e74c3c", bg: "#e74c3c15", label: "Failed",       dot: false },
}

/* ── Toast system (replaces all alert() calls) ── */
function useToast() {
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])
  const show = useCallback((msg, type = "info") => setToast({ msg, type }), [])
  return { toast, show }
}

function Toast({ toast }) {
  if (!toast) return null
  const colors = {
    success: { bg: "#001a0f", border: "#10b98144", text: "#10b981" },
    error:   { bg: "#1a0a0a", border: "#e74c3c44", text: "#e74c3c" },
    freeze:  { bg: "#060e1e", border: "#3b82f644", text: "#3b82f6" },
    info:    { bg: "#0f172a", border: "#33415544", text: "#94a3b8" },
  }
  const c = colors[toast.type] ?? colors.info
  return (
    <div style={{
      position: "fixed", bottom: 28, right: 28, zIndex: 9000,
      padding: "12px 20px", borderRadius: 10,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      fontSize: 13, fontWeight: 600,
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      animation: "slideToast 0.25s ease both",
      maxWidth: 400, wordBreak: "break-word",
    }}>
      {toast.msg}
    </div>
  )
}

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.not_deployed
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 20,
      background: cfg.bg, border: `1px solid ${cfg.color}33`,
      color: cfg.color, fontSize: 11, fontWeight: 700,
      letterSpacing: "0.05em", textTransform: "uppercase",
    }}>
      {cfg.dot && (
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: cfg.color,
          animation: status === "deploying" ? "pulse 1.2s ease-in-out infinite" : "none",
        }}/>
      )}
      {cfg.label}
    </span>
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

/* ── Freeze Modal ── */
function FreezeModal({ env, serviceName, onConfirm, onCancel, loading }) {
  const [reason, setReason] = useState("")
  const cfg = ENV_CFG[env] ?? { color: "#6366f1" }
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeUp 0.2s ease both",
    }}>
      <div style={{
        background: "#0a1020", border: `1px solid ${cfg.color}44`,
        borderRadius: 16, padding: 28, width: 440,
        boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
      }}>
        <div style={{ fontSize: 28, marginBottom: 10, textAlign: "center" }}>🧊</div>
        <h3 style={{ color: "#f1f5f9", margin: "0 0 8px", fontSize: 16, fontWeight: 800, textAlign: "center" }}>
          Freeze Deployments
        </h3>
        <p style={{ color: "#475569", fontSize: 13, margin: "0 0 6px", textAlign: "center" }}>
          <strong style={{ color: cfg.color }}>{serviceName}</strong> — {env?.toUpperCase()} environment
        </p>
        <p style={{ color: "#334155", fontSize: 12, margin: "0 0 18px", textAlign: "center" }}>
          Developers cannot deploy while frozen. Admins and SREs can still deploy.
        </p>
        <textarea
          autoFocus value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Reason (optional) — e.g. incident response, planned maintenance…"
          rows={3}
          style={{
            width: "100%", boxSizing: "border-box", marginBottom: 16,
            background: "#060b12", border: "1px solid #1e293b",
            borderRadius: 8, padding: "10px 12px",
            color: "#e2e8f0", fontSize: 12, fontFamily: "monospace",
            resize: "vertical", outline: "none",
          }}
          onFocus={e => e.target.style.borderColor = "#3b82f666"}
          onBlur={e  => e.target.style.borderColor = "#1e293b"}
        />
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => onConfirm(reason)} disabled={loading} style={{
            flex: 1, padding: "10px 0", borderRadius: 8, border: "none",
            background: loading ? "#1e293b" : "linear-gradient(135deg, #3b82f6, #2563eb)",
            color: loading ? "#475569" : "#fff",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: 13, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          }}>
            {loading ? <><Spinner color="#475569" size={13}/> Freezing…</> : <>🧊 Confirm Freeze</>}
          </button>
          <button onClick={onCancel} style={{
            flex: 1, padding: "10px 0", borderRadius: 8,
            border: "1px solid #1e293b", background: "transparent",
            color: "#475569", cursor: "pointer", fontSize: 13,
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── EnvCard ── */
function EnvCard({ env, data, deploying, pendingApproval, pipelineRunning,
  frozenInfo, canAct, canFreeze, onDeploy, onViewPipeline, onFreeze, onUnfreeze }) {

  const cfg      = ENV_CFG[env] ?? { color: "#6366f1", bg: "#0d0f2e", label: env, icon: "📦" }
  const isFrozen = !!frozenInfo?.frozen
  const isLoading = deploying?.[env] === true
  const deployBlocked = isLoading || pendingApproval || pipelineRunning
    || (isFrozen && !canFreeze)
    || !canAct

  return (
    <div style={{
      background: "#0a1020",
      border: `1px solid ${isFrozen ? "#3b82f644" : canAct ? cfg.color + "22" : "#1e293b"}`,
      borderRadius: 14, padding: 22,
      display: "flex", flexDirection: "column", gap: 14,
      position: "relative", overflow: "hidden",
      transition: "border-color 0.2s, box-shadow 0.2s",
      opacity: !canAct ? 0.88 : 1,
    }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = isFrozen ? "#3b82f688" : canAct ? cfg.color + "55" : "#334155"
        e.currentTarget.style.boxShadow   = `0 0 20px ${isFrozen ? "#3b82f60a" : cfg.color + "0a"}`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = isFrozen ? "#3b82f644" : canAct ? cfg.color + "22" : "#1e293b"
        e.currentTarget.style.boxShadow   = "none"
      }}
    >
      {/* Frozen accent stripe */}
      {isFrozen && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          background: "linear-gradient(90deg, #3b82f6, #1d4ed8, transparent)",
          borderRadius: "14px 14px 0 0",
        }}/>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: isFrozen ? "#0a1428" : cfg.bg,
            border: `1px solid ${isFrozen ? "#3b82f633" : cfg.color + "33"}`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
          }}>
            {isFrozen ? "🧊" : cfg.icon}
          </div>
          <div>
            <div style={{
              fontSize: 10, color: isFrozen ? "#3b82f6" : cfg.color,
              fontWeight: 700, letterSpacing: "0.12em",
              textTransform: "uppercase", fontFamily: "monospace",
            }}>
              {cfg.label}
            </div>
            <div style={{ fontSize: 11, color: "#334155", fontFamily: "monospace" }}>{env}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {isFrozen && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "3px 9px", borderRadius: 20,
              background: "#0a1428", border: "1px solid #3b82f644",
              color: "#3b82f6", fontSize: 10, fontWeight: 800,
              letterSpacing: "0.08em", textTransform: "uppercase",
              animation: "pulse 2.5s ease-in-out infinite",
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#3b82f6" }}/>
              FROZEN
            </span>
          )}
          <StatusBadge status={data?.status ?? "not_deployed"}/>
        </div>
      </div>

      {/* Frozen info */}
      {isFrozen && (
        <div style={{
          background: "#060e1e", border: "1px solid #3b82f633",
          borderRadius: 7, padding: "9px 13px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12 }}>🧊</span>
            <span style={{ fontSize: 11, color: "#3b82f6", fontWeight: 700 }}>
              Frozen
              {frozenInfo.frozenBy && (
                <span style={{ color: "#64748b", fontWeight: 400 }}>
                  {" "}by <strong style={{ color: "#93c5fd" }}>{frozenInfo.frozenBy}</strong>
                </span>
              )}
            </span>
          </div>
          {frozenInfo.reason && (
            <div style={{ fontSize: 11, color: "#475569", paddingLeft: 18, marginTop: 3 }}>
              {frozenInfo.reason}
            </div>
          )}
          {!canFreeze && (
            <div style={{ fontSize: 10, color: "#334155", paddingLeft: 18, marginTop: 3 }}>
              Contact an Admin or SRE to unfreeze
            </div>
          )}
        </div>
      )}

      {/* No-access banner */}
      {!canAct && !isFrozen && (
        <div style={{
          background: "#0a0f1a", border: "1px solid #33415533",
          borderRadius: 7, padding: "8px 12px",
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 11, color: "#475569",
        }}>
          <span>🔒</span>
          You don't have deploy access to this service.
        </div>
      )}

      {/* Pipeline running */}
      {pipelineRunning && !pendingApproval && !isFrozen && canAct && (
        <div style={{
          background: cfg.bg, border: `1px solid ${cfg.color}33`,
          borderRadius: 7, padding: "8px 12px",
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 11, color: cfg.color,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: cfg.color, flexShrink: 0,
            animation: "pulse 1.2s ease-in-out infinite",
          }}/>
          Pipeline in progress — concurrent deploys disabled
        </div>
      )}

      {/* Pending approval */}
      {pendingApproval && (
        <div style={{
          background: "#1a1200", border: "1px solid #f59e0b33",
          borderRadius: 7, padding: "8px 12px",
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 11, color: "#f59e0b",
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%", background: "#f59e0b",
            animation: "pulse 1.2s ease-in-out infinite",
          }}/>
          Waiting for admin approval…
        </div>
      )}

      {/* Current version */}
      <div style={{ background: "#060b12", border: "1px solid #0f172a", borderRadius: 7, padding: "9px 13px" }}>
        <div style={{ fontSize: 9, color: "#334155", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Current Version
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 12, color: data?.currentVersion ? "#e2e8f0" : "#334155" }}>
          {data?.currentVersion ?? "—  not deployed"}
        </div>
      </div>

      {data?.deployedAt && (
        <div style={{ fontSize: 11, color: "#334155" }}>
          🕐 {new Date(data.deployedAt).toLocaleString()}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
        <button
          onClick={canAct ? onDeploy : undefined}
          disabled={deployBlocked}
          title={!canAct ? "No access to this service" : isFrozen && !canFreeze ? "Frozen — contact Admin/SRE" : undefined}
          style={{
            flex: 1, padding: "9px 0", borderRadius: 8,
            border: `1px solid ${!canAct ? "#33415533" : isFrozen && !canFreeze ? "#3b82f633" : cfg.color + "44"}`,
            background: deployBlocked
              ? (!canAct ? "#0a0f1a" : isFrozen && !canFreeze ? "#0a1428" : cfg.color + "11")
              : cfg.color + "22",
            color: deployBlocked
              ? (!canAct ? "#334155" : isFrozen && !canFreeze ? "#3b82f644" : cfg.color + "88")
              : cfg.color,
            fontWeight: 700, fontSize: 12,
            cursor: deployBlocked ? "not-allowed" : "pointer",
            transition: "all 0.15s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          }}
          onMouseEnter={e => { if (!deployBlocked) e.currentTarget.style.background = cfg.color + "33" }}
          onMouseLeave={e => { if (!deployBlocked) e.currentTarget.style.background = cfg.color + "22" }}
        >
          {isLoading         ? <><Spinner color={cfg.color}/> Triggering…</>
          : pendingApproval  ? <><Spinner color={cfg.color}/> Awaiting Approval…</>
          : pipelineRunning  ? <><Spinner color={cfg.color}/> Pipeline Running…</>
          : isFrozen && !canFreeze ? <>🧊 Frozen</>
          : !canAct          ? <>🔒 No Access</>
          :                    <>▶ Deploy to {env.toUpperCase()}</>}
        </button>

        <button onClick={onViewPipeline} title="View latest pipeline" style={{
          padding: "9px 13px", borderRadius: 8,
          border: "1px solid #1e293b", background: "#060b12",
          color: "#475569", fontWeight: 600, fontSize: 12,
          cursor: "pointer", transition: "all 0.15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#94a3b8" }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#475569" }}
        >
          ⚡
        </button>

        {canFreeze && (
          isFrozen ? (
            <button onClick={() => onUnfreeze(env)} style={{
              padding: "9px 13px", borderRadius: 8,
              border: "1px solid #3b82f644", background: "#0a1428",
              color: "#3b82f6", fontWeight: 700, fontSize: 11,
              cursor: "pointer", transition: "all 0.15s",
              display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = "#10b98122"; e.currentTarget.style.borderColor = "#10b98144"; e.currentTarget.style.color = "#10b981" }}
              onMouseLeave={e => { e.currentTarget.style.background = "#0a1428";   e.currentTarget.style.borderColor = "#3b82f644"; e.currentTarget.style.color = "#3b82f6" }}
            >
              ▶ Unfreeze
            </button>
          ) : (
            <button onClick={() => onFreeze(env)} style={{
              padding: "9px 13px", borderRadius: 8,
              border: "1px solid #3b82f633", background: "transparent",
              color: "#3b82f6", fontWeight: 700, fontSize: 11,
              cursor: "pointer", transition: "all 0.15s",
              display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = "#0a1428"; e.currentTarget.style.borderColor = "#3b82f655" }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "#3b82f633" }}
            >
              🧊 Freeze
            </button>
          )
        )}
      </div>
    </div>
  )
}

function StatBox({ label, value, color = "#6366f1" }) {
  return (
    <div style={{
      background: "#0a1020", border: "1px solid #0f172a",
      borderRadius: 10, padding: "13px 16px",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "monospace" }}>{value ?? "—"}</div>
    </div>
  )
}

/* ── Main component ── */
export default function ServiceDashboard() {
  const { serviceName }  = useParams()
  const { hasRole, canActOnService, isReadOnly, isPlatformWide } = useAuth()
  const { toast, show }  = useToast()

  const canAct    = canActOnService(serviceName)
  const canFreeze = hasRole("operator")

  const [dashboard,           setDashboard]           = useState(null)
  const [deploying,           setDeploying]           = useState({})
  const [loading,             setLoading]             = useState(true)
  const [showPipeline,        setShowPipeline]        = useState(false)
  const [pipelineRunId,       setPipelineRunId]       = useState(null)
  const [pipelineEnv,         setPipelineEnv]         = useState(null)
  const [pipelineStageFilter, setPipelineStageFilter] = useState(null)
  const [lastUpdated,         setLastUpdated]         = useState(null)
  const [pendingApprovals,    setPendingApprovals]    = useState({})
  const [runningEnvs,         setRunningEnvs]         = useState({})
  const [freezeMap,           setFreezeMap]           = useState({})
  const [freezeModal,         setFreezeModal]         = useState(null)
  const [freezeLoading,       setFreezeLoading]       = useState(false)

  const pendingRef  = useRef({})
  const svcNameRef  = useRef(serviceName)
  const setPendRef  = useRef(null)
  const openPipeRef = useRef(null)

  useEffect(() => { pendingRef.current  = pendingApprovals }, [pendingApprovals])
  useEffect(() => { svcNameRef.current  = serviceName      }, [serviceName])

  const openPipelineView = useCallback((runId, env, stageFilter = null) => {
    setPipelineRunId(runId)
    setPipelineEnv(env)
    setPipelineStageFilter(stageFilter)
    setShowPipeline(true)
  }, [])

  useEffect(() => {
    setPendRef.current  = setPendingApprovals
    openPipeRef.current = openPipelineView
  }, [openPipelineView])

  const loadFreezeStatus = useCallback(async () => {
    try {
      const list = await fetchFreezeStatus(serviceName)
      const map  = {}
      if (Array.isArray(list)) list.forEach(fs => { map[fs.environment] = fs })
      setFreezeMap(map)
    } catch (err) {
      console.warn("[freeze] load failed:", err.message)
    }
  }, [serviceName])

  // Approval polling
  useEffect(() => {
    const iv = setInterval(async () => {
      const pending = pendingRef.current
      if (!Object.keys(pending).length) return
      for (const [env, approvalId] of Object.entries(pending)) {
        try {
          const a = await fetchApprovalById(approvalId)
          if (a.status === "rejected") {
            setPendRef.current(p => { const n = { ...p }; delete n[env]; return n })
            show(`Production deployment for ${svcNameRef.current} was rejected`, "error")
          } else if (a.status === "approved" && a.runId) {
            setPendRef.current(p => { const n = { ...p }; delete n[env]; return n })
            openPipeRef.current(a.runId, env)
          }
        } catch {}
      }
    }, APPROVAL_POLL_MS)
    return () => clearInterval(iv)
  }, [show])

  // Restore pending approvals
  useEffect(() => {
    fetchProdApprovals()
      .then(all => {
        if (!Array.isArray(all)) return
        for (const a of all) {
          if (a.serviceName === serviceName && a.status === "pending") {
            setPendingApprovals({ prod: a.id }); break
          }
        }
      })
      .catch(() => {})
  }, [serviceName])

  // Dashboard + pipeline status polling
  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const data = await fetchServiceDashboard(serviceName)
        if (!mounted) return
        setDashboard(data)
        setLastUpdated(new Date())
        const allEnvs = data?.environments ? Object.keys(data.environments) : DEFAULT_ENVS
        const running = {}
        for (const env of allEnvs) {
          try {
            const latest = await fetchLatestPipelineRun(serviceName, env)
            if (latest?.status === "pending" || latest?.status === "running") running[env] = true
          } catch {}
        }
        if (mounted) setRunningEnvs(running)
      } catch {
        if (mounted) setDashboard(null)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    const iv = setInterval(load, POLL_INTERVAL_MS)
    return () => { mounted = false; clearInterval(iv) }
  }, [serviceName])

  useEffect(() => { loadFreezeStatus() }, [loadFreezeStatus])

  /* ── Freeze ── */
  const handleFreezeConfirm = async (reason) => {
    const env = freezeModal
    setFreezeLoading(true)
    try {
      await freezeDeployment(serviceName, env, reason)
      await loadFreezeStatus()
      show(`🧊 ${env.toUpperCase()} deployments frozen`, "freeze")
    } catch (err) {
      show(`❌ ${err.message}`, "error")
    } finally {
      setFreezeLoading(false)
      setFreezeModal(null)
    }
  }

  const handleUnfreeze = async (env) => {
    try {
      await unfreezeDeployment(serviceName, env)
      await loadFreezeStatus()
      show(`✅ ${env.toUpperCase()} deployments unfrozen`, "success")
    } catch (err) {
      show(`❌ ${err.message}`, "error")
    }
  }

  /* ── Deploy ── */
  const handleDeploy = async (env) => {
    if (!canAct) return
    if (deploying[env] || pendingApprovals[env] || runningEnvs[env]) return
    if (freezeMap[env]?.frozen && !canFreeze) return

    setDeploying(p => ({ ...p, [env]: true }))
    try {
      const res = await deployService(serviceName, env)
      if (res?.status === "pending_approval") {
        setPendingApprovals(p => ({ ...p, [env]: res.approvalId }))
        return
      }
      let runId = res?.runId ?? res?.run_id ?? res?.id ?? null
      await new Promise(r => setTimeout(r, 2000))
      if (!runId) {
        for (let i = 0; i < 6; i++) {
          try {
            const latest = await fetchLatestPipelineRun(serviceName, env)
            const id = latest?.id ?? latest?.runId ?? latest?.run_id
            if (id) { runId = id; break }
          } catch {}
          await new Promise(r => setTimeout(r, 2000))
        }
      }
      if (!runId) throw new Error("Pipeline run not found after deploy trigger")
      openPipelineView(runId, env)
    } catch (err) {
      setPendingApprovals(p => { const n = { ...p }; delete n[env]; return n })
      show(`❌ Deployment failed: ${err.message}`, "error")
    } finally {
      setDeploying(p => ({ ...p, [env]: false }))
    }
  }

  const handleViewPipeline = async (env) => {
    try {
      const run = await fetchLatestPipelineRun(serviceName, env)
      const id  = run?.id ?? run?.runId ?? run?.run_id
      if (id) { openPipelineView(id, env); return }
      show("No pipeline runs found for " + env, "info")
    } catch {
      show("No pipeline runs found for " + env, "info")
    }
  }

  const closePipeline = () => {
    setShowPipeline(false); setPipelineRunId(null)
    setPipelineEnv(null);   setPipelineStageFilter(null)
  }

  const envs           = dashboard?.environments ? Object.keys(dashboard.environments) : DEFAULT_ENVS
  const deployedCount  = envs.filter(e => dashboard?.environments?.[e]?.status === "deployed").length
  const frozenCount    = Object.values(freezeMap).filter(fs => fs?.frozen).length

  return (
    <div style={{
      minHeight: "100vh", background: "#060b12",
      color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif", padding: "28px 32px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&display=swap');
        @keyframes spin      { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        @keyframes pulse     { 0%,100% { opacity:1 } 50% { opacity:0.3 } }
        @keyframes fadeUp    { from { opacity:0;transform:translateY(12px) } to { opacity:1;transform:translateY(0) } }
        @keyframes slideIn   { from { opacity:0;transform:translateX(24px) } to { opacity:1;transform:translateX(0) } }
        @keyframes slideToast{ from { opacity:0;transform:translateY(16px) } to { opacity:1;transform:translateY(0) } }
      `}</style>

      <Toast toast={toast}/>

      {freezeModal && (
        <FreezeModal
          env={freezeModal} serviceName={serviceName}
          onConfirm={handleFreezeConfirm}
          onCancel={() => setFreezeModal(null)}
          loading={freezeLoading}
        />
      )}

      {/* Back */}
      <div style={{ marginBottom: 24, animation: "fadeUp 0.35s ease both" }}>
        <Link to="/" style={{
          color: "#334155", fontSize: 12, fontWeight: 600, textDecoration: "none",
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 11px", borderRadius: 7, border: "1px solid #0f172a", background: "#0a1020",
          transition: "all 0.15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.color = "#94a3b8"; e.currentTarget.style.borderColor = "#1e293b" }}
          onMouseLeave={e => { e.currentTarget.style.color = "#334155"; e.currentTarget.style.borderColor = "#0f172a" }}
        >
          ← Back to Services
        </Link>
      </div>

      {/* Header */}
      <div style={{
        marginBottom: 28, display: "flex", alignItems: "flex-start",
        justifyContent: "space-between", flexWrap: "wrap", gap: 12,
        animation: "fadeUp 0.35s ease 0.05s both",
      }}>
        <div>
          <div style={{
            fontSize: 10, color: "#6366f1", fontWeight: 700,
            letterSpacing: "0.2em", textTransform: "uppercase",
            fontFamily: "monospace", marginBottom: 6,
          }}>
            Service Dashboard
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.02em" }}>
            {serviceName}
          </h1>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {isReadOnly && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "4px 12px", borderRadius: 20,
              background: "#1e293b", border: "1px solid #334155",
              color: "#64748b", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              👁 Read-only
            </span>
          )}
          {!isReadOnly && !canAct && !isPlatformWide && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "4px 12px", borderRadius: 20,
              background: "#1a0a0a", border: "1px solid #e74c3c33",
              color: "#e74c3c", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              🚫 No Access
            </span>
          )}
          {frozenCount > 0 && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 13px", borderRadius: 20,
              background: "#060e1e", border: "1px solid #3b82f644",
              color: "#3b82f6", fontSize: 11, fontWeight: 700,
              animation: "pulse 2.5s ease-in-out infinite",
            }}>
              🧊 {frozenCount} env{frozenCount > 1 ? "s" : ""} frozen
            </span>
          )}
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
            Live · {POLL_INTERVAL_MS / 1000}s
            {lastUpdated && <span style={{ color: "#1e293b", marginLeft: 3 }}>· {lastUpdated.toLocaleTimeString()}</span>}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 24,
        animation: "fadeUp 0.35s ease 0.08s both",
      }}>
        <StatBox label="Environments" value={envs.length}          color="#6366f1"/>
        <StatBox label="Deployed"     value={deployedCount}        color="#10b981"/>
        <StatBox label="Frozen Envs"  value={frozenCount}          color={frozenCount > 0 ? "#3b82f6" : "#334155"}/>
        <StatBox label="Runtime"      value={dashboard?.runtime ?? "—"} color="#06b6d4"/>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#334155", padding: "60px 0" }}>
          <Spinner color="#6366f1" size={16}/> Loading {serviceName}…
        </div>
      )}

      {/* Env cards + pipeline view */}
      {!loading && (
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", animation: "fadeUp 0.35s ease 0.12s both" }}>
          <div style={{
            flex: showPipeline ? "0 0 auto" : "1 1 auto",
            width: showPipeline ? "min(340px, 42%)" : "100%",
            transition: "width 0.3s ease",
          }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: showPipeline ? "1fr" : "repeat(auto-fill,minmax(290px,1fr))",
              gap: 14,
            }}>
              {envs.map(env => (
                <EnvCard
                  key={env}
                  env={env}
                  data={dashboard?.environments?.[env]}
                  deploying={deploying}
                  pendingApproval={!!pendingApprovals[env]}
                  pipelineRunning={!!runningEnvs[env]}
                  frozenInfo={freezeMap[env] ?? null}
                  canAct={canAct}
                  canFreeze={canFreeze}
                  onDeploy={() => handleDeploy(env)}
                  onViewPipeline={() => handleViewPipeline(env)}
                  onFreeze={e => setFreezeModal(e)}
                  onUnfreeze={handleUnfreeze}
                />
              ))}
            </div>
          </div>

          {showPipeline && pipelineRunId && (
            <div style={{
              flex: "1 1 auto", minWidth: 0,
              height: "calc(100vh - 260px)", minHeight: 480,
              animation: "slideIn 0.25s ease both", position: "sticky", top: 28,
            }}>
              <PipelineView
                runId={pipelineRunId} serviceName={serviceName}
                environment={pipelineEnv} onClose={closePipeline}
                stageFilter={pipelineStageFilter}
              />
            </div>
          )}
        </div>
      )}

      {/* Rollback — only if user can act on this service */}
      {!loading && dashboard && canAct && (
        <div style={{ marginTop: 24 }}>
          <ServiceCard
            serviceName={serviceName}
            dashboard={dashboard}
            onRollbackSuccess={openPipelineView}
            runningEnvs={runningEnvs}
          />
        </div>
      )}

      {/* Rollback locked notice */}
      {!loading && dashboard && !canAct && (
        <div style={{
          marginTop: 24, padding: "16px 20px",
          background: "#0a0f1a", border: "1px solid #1e293b",
          borderRadius: 12, display: "flex", alignItems: "center", gap: 12,
          color: "#334155", fontSize: 13,
        }}>
          <span style={{ fontSize: 20 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 700, color: "#475569", marginBottom: 2 }}>Rollback not available</div>
            <div style={{ fontSize: 12 }}>
              {isReadOnly
                ? "Read-only access. Contact an Admin or SRE to perform a rollback."
                : "You don't have deploy access to this service. Contact the service team or a platform admin."}
            </div>
          </div>
        </div>
      )}

      {/* Recent Deployments */}
      {!loading && dashboard?.artifacts?.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{
            fontSize: 10, color: "#334155", fontWeight: 700,
            letterSpacing: "0.15em", textTransform: "uppercase",
            marginBottom: 10, fontFamily: "monospace",
          }}>
            Recent Deployments
          </div>
          <div style={{ background: "#0a1020", border: "1px solid #0f172a", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #0f172a" }}>
                  {["Version","Environment","Action","Status","Time"].map(h => (
                    <th key={h} style={{
                      padding: "9px 14px", textAlign: "left",
                      fontSize: 9, color: "#334155", fontWeight: 700,
                      letterSpacing: "0.1em", textTransform: "uppercase",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dashboard.artifacts.slice(0, 8).map((a, i) => (
                  <tr key={i}
                    style={{ borderBottom: "1px solid #0a1020", transition: "background 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#060b12"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "9px 14px", fontFamily: "monospace", fontSize: 11, color: "#94a3b8" }}>{a.version}</td>
                    <td style={{ padding: "9px 14px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: ENV_CFG[a.environment]?.color ?? "#94a3b8", fontFamily: "monospace" }}>
                        {a.environment}
                      </span>
                    </td>
                    <td style={{ padding: "9px 14px", fontSize: 11, color: "#475569", textTransform: "capitalize" }}>{a.action}</td>
                    <td style={{ padding: "9px 14px" }}><StatusBadge status={a.status}/></td>
                    <td style={{ padding: "9px 14px", fontSize: 11, color: "#334155", fontFamily: "monospace" }}>
                      {a.createdAt ? new Date(a.createdAt).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
