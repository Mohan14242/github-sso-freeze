import { useState, useEffect, useRef } from "react"
import { fetchPipelineRun, streamPipelineRun } from "../api/pipelineApi"

const STAGE_ICONS = {
  "Checkout":        "📥",
  "Setup":           "⚙️",
  "Build":           "🔨",
  "Test":            "🧪",
  "Docker Build":    "🐳",
  "Docker Push":     "📤",
  "Push Image":      "📤",
  "Deploy":          "🚀",
  "Health Check":    "❤️",
  "Rollback":        "↩️",
}

const STATUS_CFG = {
  pending:  { color: "#475569", bg: "#0f172a", border: "#1e293b",   label: "Pending", icon: "○", pulse: false },
  running:  { color: "#f59e0b", bg: "#1a1000", border: "#f59e0b55", label: "Running", icon: "◐", pulse: true  },
  success:  { color: "#10b981", bg: "#001a0f", border: "#10b98155", label: "Success", icon: "✓", pulse: false },
  failed:   { color: "#e74c3c", bg: "#1a0a0a", border: "#e74c3c55", label: "Failed",  icon: "✗", pulse: false },
  skipped:  { color: "#64748b", bg: "#0f172a", border: "#33415544", label: "Skipped", icon: "–", pulse: false },
}

const RUN_STATUS_CFG = {
  pending:   { color: "#475569", label: "Pending",   icon: "⏳", pulse: false },
  running:   { color: "#f59e0b", label: "Running",   icon: "⚡", pulse: true  },
  success:   { color: "#10b981", label: "Success",   icon: "✅", pulse: false },
  failed:    { color: "#e74c3c", label: "Failed",    icon: "❌", pulse: false },
  cancelled: { color: "#64748b", label: "Cancelled", icon: "🚫", pulse: false },
}

function formatDuration(startedAt, completedAt) {
  if (!startedAt) return null
  const start = new Date(startedAt)
  const end   = completedAt ? new Date(completedAt) : new Date()
  const secs  = Math.floor((end - start) / 1000)
  if (isNaN(secs) || secs < 0) return null
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

// ── CHANGE 1: accept stageFilter prop ────────────────────────────
// stageFilter: optional string[] passed from ServiceDashboard.
// When provided (rollback): only stages whose stageName is in the
// list are rendered. The backend already creates only those stages
// for a rollback run, so this mainly drives the badge + label.
// When null/undefined (normal deploy): all stages are shown.
export default function PipelineView({ runId, serviceName, environment, onClose, stageFilter }) {
  const [run,         setRun]         = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [sseStatus,   setSseStatus]   = useState("connecting")
  const [expandedLog, setExpandedLog] = useState(null)
  const cleanupRef                    = useRef(null)
  const timerRef                      = useRef(null)

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setRun(prev => prev ? { ...prev, _tick: Date.now() } : prev)
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [])

  useEffect(() => {
    if (!runId) return
    setSseStatus("connecting")
    setLoading(true)

    const cleanup = streamPipelineRun(runId, {
      onSnapshot: (event) => {
        const data = event.payload ?? event
        setRun(data)
        setLoading(false)
        setSseStatus("live")
      },
      onStageUpdated: (event) => {
        const stage = event.payload ?? event
        setRun(prev => {
          if (!prev) return prev
          return {
            ...prev,
            stages: prev.stages.map(s =>
              s.stageName === stage.stageName ? { ...s, ...stage } : s
            ),
          }
        })
      },
      onRunUpdated: (event) => {
        const data = event.payload ?? event
        setRun(prev => prev ? { ...prev, status: data.status, completedAt: data.completedAt } : prev)
      },
      onCompleted: (event) => {
        const data = event.payload ?? event
        setRun(prev => prev ? { ...prev, status: data.status, completedAt: data.completedAt } : prev)
        setSseStatus("completed")
        clearInterval(timerRef.current)
      },
      onError: () => {
        setSseStatus("error")
        setLoading(false)
        fetchPipelineRun(runId)
          .then(data => { setRun(data); setLoading(false) })
          .catch(() => {})
      },
    })

    cleanupRef.current = cleanup
    return () => { cleanup(); clearInterval(timerRef.current) }
  }, [runId])

  // ── CHANGE 2: compute visibleStages ──────────────────────────
  // When stageFilter is provided, only show matching stages.
  // For rollback runs the backend only creates 2 stages anyway
  // ("Rollback" and "Health Check"), so this is mostly for safety
  // and to drive the "Rollback view" badge in the header.
  const visibleStages = run?.stages
    ? (stageFilter?.length
        ? run.stages.filter(s => stageFilter.includes(s.stageName))
        : run.stages)
    : []

  const runCfg       = run ? (RUN_STATUS_CFG[run.status] ?? RUN_STATUS_CFG.pending) : null
  // ── CHANGE 3: use visibleStages for progress counts ──────────
  const successCount = visibleStages.filter(s => s.status === "success").length
  const totalCount   = visibleStages.length
  const progressPct  = totalCount > 0 ? (successCount / totalCount) * 100 : 0

  return (
    <div style={{
      height: "100%",
      background: "#080d14",
      border: "1px solid #1e293b",
      borderRadius: 16,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
    }}>

      {/* ── Header ── */}
      <div style={{
        padding: "18px 24px",
        borderBottom: "1px solid #0f172a",
        background: "#060b12",
        flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, color: "#6366f1",
            letterSpacing: "0.15em", textTransform: "uppercase",
            fontFamily: "monospace", marginBottom: 5,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            Pipeline Run #{runId}
            <span style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "2px 7px", borderRadius: 10,
              background: sseStatus === "live"      ? "#001a0f" :
                          sseStatus === "completed" ? "#001a0f" :
                          sseStatus === "error"     ? "#1a0a0a" : "#0f172a",
              border: `1px solid ${
                sseStatus === "live"      ? "#10b98133" :
                sseStatus === "completed" ? "#10b98133" :
                sseStatus === "error"     ? "#e74c3c33" : "#1e293b"
              }`,
              color: sseStatus === "live"      ? "#10b981" :
                     sseStatus === "completed" ? "#10b981" :
                     sseStatus === "error"     ? "#e74c3c" : "#475569",
              fontSize: 9,
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: "50%",
                background: "currentColor",
                animation: sseStatus === "live" ? "pulse 1.5s ease-in-out infinite" : "none",
              }}/>
              {sseStatus === "live"       ? "LIVE"
              : sseStatus === "completed" ? "DONE"
              : sseStatus === "error"     ? "FALLBACK"
              : "CONNECTING"}
            </span>

            {/* ── CHANGE 4: rollback view badge in header ── */}
            {stageFilter?.length > 0 && (
              <span style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "2px 7px", borderRadius: 10,
                background: "#1a0a30", border: "1px solid #6366f133",
                color: "#6366f1", fontSize: 9,
              }}>
                ↩️ Rollback view
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16 }}>
              {serviceName}
            </span>
            <span style={{
              padding: "2px 8px", borderRadius: 4,
              background: "#1e293b", border: "1px solid #334155",
              color: "#64748b", fontSize: 11, fontFamily: "monospace",
            }}>
              {environment}
            </span>
            {runCfg && (
              <span style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "3px 10px", borderRadius: 20,
                background: runCfg.color + "22",
                border: `1px solid ${runCfg.color}44`,
                color: runCfg.color, fontSize: 11, fontWeight: 700,
                animation: runCfg.pulse ? "pulse 1.5s ease-in-out infinite" : "none",
              }}>
                {runCfg.icon} {runCfg.label}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {run && (
            <div style={{ fontSize: 13, color: "#334155", fontFamily: "monospace", fontWeight: 600 }}>
              ⏱ {formatDuration(run.startedAt, run.completedAt) ?? "—"}
            </div>
          )}
          <button
            onClick={() => { cleanupRef.current?.(); onClose() }}
            style={{
              background: "none", border: "1px solid #1e293b",
              borderRadius: 7, color: "#475569", cursor: "pointer",
              padding: "6px 12px", fontSize: 12, fontWeight: 600,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#e74c3c"; e.currentTarget.style.color = "#e74c3c" }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#475569" }}
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#475569", padding: "40px 0" }}>
            <div style={{
              width: 16, height: 16, borderRadius: "50%",
              border: "2px solid #1e293b", borderTop: "2px solid #6366f1",
              animation: "spin 1s linear infinite",
            }}/>
            Connecting to pipeline stream…
          </div>
        )}

        {!loading && run && (
          <>
            {/* Progress bar — uses visibleStages counts */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  {/* ── CHANGE 5: label differs for rollback view ── */}
                  {stageFilter?.length ? "Rollback progress" : "Progress"}
                </span>
                <span style={{ fontSize: 11, color: "#475569", fontFamily: "monospace" }}>
                  {successCount} / {totalCount} stages complete
                </span>
              </div>
              <div style={{ height: 6, background: "#0f172a", borderRadius: 3, overflow: "hidden", border: "1px solid #1e293b" }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  background: run.status === "failed"
                    ? "linear-gradient(90deg, #e74c3c, #c0392b)"
                    : "linear-gradient(90deg, #6366f1, #10b981)",
                  width: `${progressPct}%`,
                  transition: "width 0.6s ease",
                }}/>
              </div>
            </div>

            {/* ── CHANGE 6: info strip shown only in rollback view ── */}
            {stageFilter?.length > 0 && (
              <div style={{
                marginBottom: 16, padding: "8px 12px",
                background: "#0d0a1a", border: "1px solid #6366f122",
                borderRadius: 7, display: "flex", alignItems: "center", gap: 8,
                fontSize: 11, color: "#6366f1",
              }}>
                <span>↩️</span>
                <span>
                  Rollback pipeline — showing: {stageFilter.join(", ")}
                </span>
              </div>
            )}

            {/* Stage timeline — uses visibleStages */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {/* ── CHANGE 7: render visibleStages instead of run.stages ── */}
              {visibleStages.map((stage, idx) => {
                const cfg         = STATUS_CFG[stage.status] ?? STATUS_CFG.pending
                const isExpanded  = expandedLog === stage.id
                const hasLogs     = !!stage.logs
                const prevSuccess = idx > 0 && visibleStages[idx - 1].status === "success"

                return (
                  <div key={stage.id || idx}>
                    {idx > 0 && (
                      <div style={{
                        width: 2, height: 12, marginLeft: 23,
                        background: prevSuccess ? "#10b98144" : "#1e293b",
                        transition: "background 0.3s",
                      }}/>
                    )}

                    <div
                      onClick={() => hasLogs && setExpandedLog(isExpanded ? null : stage.id)}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 12,
                        padding: "12px 14px",
                        background: cfg.bg,
                        border: `1px solid ${cfg.border}`,
                        borderRadius: 8,
                        cursor: hasLogs ? "pointer" : "default",
                        transition: "border-color 0.2s, background 0.2s",
                      }}
                    >
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%",
                        background: "#060b12",
                        border: `2px solid ${cfg.color}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, color: cfg.color, fontWeight: 800,
                        flexShrink: 0,
                        boxShadow: stage.status === "running" ? `0 0 10px ${cfg.color}44` : "none",
                        transition: "box-shadow 0.3s",
                      }}>
                        {cfg.icon}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14 }}>{STAGE_ICONS[stage.stageName] ?? "▸"}</span>
                            <span style={{
                              color: stage.status === "pending" ? "#475569" : "#e2e8f0",
                              fontWeight: stage.status === "running" ? 700 : 500,
                              fontSize: 13,
                            }}>
                              {stage.stageName}
                            </span>
                            {stage.status === "running" && (
                              <span style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700, animation: "pulse 1s ease-in-out infinite" }}>
                                ● live
                              </span>
                            )}
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                            {stage.startedAt && (
                              <span style={{ fontSize: 11, color: "#334155", fontFamily: "monospace" }}>
                                {formatDuration(stage.startedAt, stage.completedAt || undefined)}
                              </span>
                            )}
                            <span style={{
                              padding: "2px 8px", borderRadius: 20,
                              background: cfg.color + "22", color: cfg.color,
                              fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                            }}>
                              {cfg.label}
                            </span>
                            {hasLogs && (
                              <svg width="12" height="12" fill="none" stroke="#334155" strokeWidth="2" viewBox="0 0 24 24"
                                style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
                              >
                                <path d="M9 18l6-6-6-6"/>
                              </svg>
                            )}
                          </div>
                        </div>

                        {isExpanded && hasLogs && (
                          <div style={{
                            marginTop: 10, background: "#020608",
                            border: "1px solid #0f172a", borderRadius: 6,
                            padding: "10px 12px", fontFamily: "monospace",
                            fontSize: 11, color: "#64748b", whiteSpace: "pre-wrap",
                            maxHeight: 200, overflowY: "auto", lineHeight: 1.7,
                          }}>
                            {stage.logs}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Final result banner */}
            {(run.status === "success" || run.status === "failed") && (
              <div style={{
                marginTop: 20, padding: "16px 20px", borderRadius: 10,
                background: run.status === "success" ? "#001a0f" : "#1a0a0a",
                border: `1px solid ${run.status === "success" ? "#10b98133" : "#e74c3c33"}`,
                display: "flex", alignItems: "center", gap: 14,
              }}>
                <span style={{ fontSize: 28 }}>{run.status === "success" ? "🎉" : "💥"}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: run.status === "success" ? "#10b981" : "#e74c3c" }}>
                    {/* ── CHANGE 8: different success message for rollback ── */}
                    {run.status === "success"
                      ? stageFilter?.length
                        ? "Rollback completed successfully"
                        : "Pipeline completed successfully"
                      : "Pipeline failed — check stage logs above"}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 3 }}>
                    Total time: {formatDuration(run.startedAt, run.completedAt) ?? "—"}
                  </div>
                </div>
              </div>
            )}

            {sseStatus === "live" && (run.status === "pending" || run.status === "running") && (
              <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, color: "#334155", fontSize: 11 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%", background: "#10b981",
                  animation: "pulse 1.5s ease-in-out infinite", display: "inline-block",
                }}/>
                Streaming live updates via SSE — no polling needed
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes spin  { from { transform: rotate(0deg);  } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  )
}
