import { useState, useRef } from "react"
import yaml from "js-yaml"
import { apiFetch } from "../api/index"

const DEFAULT_YAML = `serviceName: orders
repoName: orders-service
runtime: go
cicdType: github
templateVersion: v1
deploytype: ec2
environments:
  - dev
  - test
  - prod
enableWebhook: false`

const YAML_FIELDS = [
  { key: "serviceName",     label: "Service Name",      hint: "e.g. orders"         },
  { key: "repoName",        label: "Repo Name",         hint: "e.g. orders-service" },
  { key: "runtime",         label: "Runtime",           hint: "go / node / python"  },
  { key: "cicdType",        label: "CI/CD Type",        hint: "github / jenkins"    },
  { key: "templateVersion", label: "Template Version",  hint: "e.g. v1"             },
  { key: "deploytype",      label: "Deploy Type",       hint: "ec2 / microservice"  },
]

export default function CreateServiceForm() {
  const [yamlText, setYamlText]     = useState(DEFAULT_YAML)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState("")
  const [success, setSuccess]       = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const [parsed, setParsed]         = useState(null)
  const [parseError, setParseError] = useState("")
  const fileRef = useRef()

  const handleYamlChange = (val) => {
    setYamlText(val)
    setError("")
    setSuccess("")
    try {
      setParsed(yaml.load(val))
      setParseError("")
    } catch (e) {
      setParsed(null)
      setParseError(e.message)
    }
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) loadFile(file)
  }

  const loadFile = async (file) => {
    const text = await file.text()
    handleYamlChange(text)
    setSuccess("📄 File loaded — " + file.name)
  }

  const submitYAML = async () => {
    setError("")
    setSuccess("")

    if (!yamlText.trim()) { setError("YAML cannot be empty"); return }
    if (parseError)        { setError("Fix YAML errors before submitting"); return }

    setLoading(true)
    try {
      const res = await apiFetch("/api/create-service", {
        method: "POST",
        headers: { "Content-Type": "application/x-yaml" },
        body: yamlText,
      })
      if (!res) return
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || "API error")
      }
      // ✅ CHANGE 1 — was: setSuccess("Service created → " + data.repoUrl)
      setSuccess("Request submitted — awaiting admin approval")
    } catch (err) {
      setError(err.message || "Unknown error")
    } finally {
      setLoading(false)
    }
  }

  const previewValue = (key) => {
    if (!parsed) return "—"
    const v = parsed[key]
    if (Array.isArray(v)) return v.join(", ")
    return v ?? "—"
  }

  return (
    <div style={{ padding: "40px 48px", maxWidth: 1100 }}>

      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.15em",
            textTransform: "uppercase", color: "#6366f1", fontFamily: "monospace",
          }}>
            Service Provisioning
          </span>
        </div>
        <h2 style={{
          color: "#f1f5f9", margin: 0,
          fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700,
        }}>
          Create New Service
        </h2>
        <p style={{ color: "#475569", marginTop: 6, fontSize: 14 }}>
          Define your service in YAML — paste, type, or drop a file.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>

        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            style={{
              position: "relative",
              borderRadius: 12,
              border: `1px solid ${isDragging ? "#6366f1" : parseError ? "#e74c3c44" : "#1e293b"}`,
              background: isDragging ? "#13172a" : "#0a0f1a",
              transition: "border-color 0.15s, background 0.15s",
              overflow: "hidden",
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 16px",
              background: "#0f172a",
              borderBottom: `1px solid ${parseError ? "#e74c3c44" : "#1e293b"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  {["#e74c3c","#f39c12","#2ecc71"].map(c => (
                    <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, opacity: 0.7 }}/>
                  ))}
                </div>
                <span style={{ color: "#334155", fontSize: 12, fontFamily: "monospace", marginLeft: 4 }}>
                  service.yaml
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {parseError && (
                  <span style={{ fontSize: 11, color: "#e74c3c", fontFamily: "monospace" }}>
                    ✗ parse error
                  </span>
                )}
                {!parseError && parsed && (
                  <span style={{ fontSize: 11, color: "#2ecc71", fontFamily: "monospace" }}>
                    ✓ valid yaml
                  </span>
                )}
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{
                    padding: "4px 10px", borderRadius: 5,
                    border: "1px solid #1e293b", background: "transparent",
                    color: "#64748b", cursor: "pointer", fontSize: 11,
                    display: "flex", alignItems: "center", gap: 5,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#6366f1"; e.currentTarget.style.color = "#6366f1" }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#64748b" }}
                >
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                  </svg>
                  Upload
                </button>
                <input
                  ref={fileRef} type="file" accept=".yaml,.yml"
                  style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f) }}
                />
              </div>
            </div>

            <div style={{ display: "flex" }}>
              <div style={{
                padding: "16px 12px",
                background: "#080d14",
                borderRight: "1px solid #1e293b",
                userSelect: "none",
                minWidth: 40,
                textAlign: "right",
              }}>
                {yamlText.split("\n").map((_, i) => (
                  <div key={i} style={{
                    fontSize: 12, lineHeight: "21px",
                    color: "#2d3748", fontFamily: "monospace",
                  }}>
                    {i + 1}
                  </div>
                ))}
              </div>

              <textarea
                value={yamlText}
                onChange={e => handleYamlChange(e.target.value)}
                spellCheck={false}
                style={{
                  flex: 1,
                  minHeight: 340,
                  padding: "16px",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  resize: "vertical",
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                  fontSize: 13,
                  lineHeight: "21px",
                  color: "#e2e8f0",
                  caretColor: "#6366f1",
                }}
              />
            </div>

            {isDragging && (
              <div style={{
                position: "absolute", inset: 0,
                background: "rgba(99,102,241,0.08)",
                display: "flex", alignItems: "center", justifyContent: "center",
                backdropFilter: "blur(2px)",
                borderRadius: 12,
              }}>
                <div style={{
                  border: "2px dashed #6366f1", borderRadius: 10,
                  padding: "24px 40px", textAlign: "center",
                }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                  <div style={{ color: "#6366f1", fontWeight: 600, fontSize: 14 }}>Drop YAML file here</div>
                </div>
              </div>
            )}
          </div>

          {parseError && (
            <div style={{
              marginTop: 8, padding: "10px 14px",
              background: "#1a0a0a", border: "1px solid #e74c3c33",
              borderRadius: 8,
            }}>
              <span style={{ fontSize: 12, color: "#e74c3c", fontFamily: "monospace" }}>
                ⚠ {parseError}
              </span>
            </div>
          )}

          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={submitYAML}
              disabled={loading || !!parseError}
              style={{
                padding: "12px 32px",
                borderRadius: 8,
                border: "none",
                background: loading || parseError
                  ? "#1e293b"
                  : "linear-gradient(135deg, #6366f1, #4f46e5)",
                color: loading || parseError ? "#475569" : "#fff",
                cursor: loading || parseError ? "not-allowed" : "pointer",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.02em",
                display: "flex", alignItems: "center", gap: 8,
                transition: "opacity 0.15s",
                boxShadow: loading || parseError ? "none" : "0 4px 20px rgba(99,102,241,0.35)",
              }}
              onMouseEnter={e => { if (!loading && !parseError) e.currentTarget.style.opacity = "0.9" }}
              onMouseLeave={e => { e.currentTarget.style.opacity = "1" }}
            >
              {loading ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    style={{ animation: "spin 1s linear infinite" }}>
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                  </svg>
                  {/* ✅ CHANGE 2 — was: Creating service… */}
                  Submitting request…
                </>
              ) : (
                <>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
                  </svg>
                  {/* ✅ CHANGE 2 — was: Create Service */}
                  Request Service Creation
                </>
              )}
            </button>

            <button
              onClick={() => { handleYamlChange(DEFAULT_YAML); setError(""); setSuccess("") }}
              style={{
                padding: "12px 20px", borderRadius: 8,
                border: "1px solid #1e293b", background: "transparent",
                color: "#475569", cursor: "pointer", fontSize: 13,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#64748b" }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#475569" }}
            >
              Reset
            </button>
          </div>

          {error && (
            <div style={{
              marginTop: 14, padding: "12px 16px",
              background: "#1a0a0a", border: "1px solid #e74c3c44",
              borderRadius: 8, display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: 16 }}>❌</span>
              <span style={{ color: "#e74c3c", fontSize: 13 }}>{error}</span>
            </div>
          )}
          {success && (
            <div style={{
              marginTop: 14, padding: "12px 16px",
              background: "#0a1a0f", border: "1px solid #2ecc7144",
              borderRadius: 8, display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: 16 }}>✅</span>
              <span style={{ color: "#2ecc71", fontSize: 13, wordBreak: "break-all" }}>{success}</span>
            </div>
          )}
        </div>

        {/* ── Right: live preview ── */}
        <div style={{
          background: "#0a0f1a",
          border: "1px solid #1e293b",
          borderRadius: 12,
          overflow: "hidden",
          position: "sticky",
          top: 24,
        }}>
          <div style={{
            padding: "12px 16px",
            background: "#0f172a",
            borderBottom: "1px solid #1e293b",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <svg width="14" height="14" fill="none" stroke="#6366f1" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <span style={{ color: "#64748b", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Live Preview
            </span>
          </div>

          <div style={{ padding: "16px" }}>
            {YAML_FIELDS.map((field, i) => (
              <div key={field.key} style={{
                padding: "11px 0",
                borderBottom: i < YAML_FIELDS.length - 1 ? "1px solid #0f172a" : "none",
                display: "flex", flexDirection: "column", gap: 3,
              }}>
                <span style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  {field.label}
                </span>
                <span style={{
                  fontSize: 13, fontFamily: "monospace",
                  color: previewValue(field.key) === "—" ? "#1e293b" : "#e2e8f0",
                }}>
                  {previewValue(field.key)}
                </span>
              </div>
            ))}

            <div style={{ padding: "11px 0", borderTop: "1px solid #0f172a" }}>
              <span style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Environments
              </span>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                {parsed?.environments && Array.isArray(parsed.environments)
                  ? parsed.environments.map(env => (
                    <span key={env} style={{
                      padding: "2px 8px", borderRadius: 4,
                      background: "#1e293b", border: "1px solid #334155",
                      color: "#94a3b8", fontSize: 11, fontFamily: "monospace",
                    }}>
                      {env}
                    </span>
                  ))
                  : <span style={{ color: "#1e293b", fontSize: 13, fontFamily: "monospace" }}>—</span>
                }
              </div>
            </div>

            <div style={{ padding: "11px 0", borderTop: "1px solid #0f172a" }}>
              <span style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Webhook
              </span>
              <div style={{ marginTop: 6 }}>
                <span style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                  background: parsed?.enableWebhook ? "#0a1a0f" : "#1a0a0a",
                  border: `1px solid ${parsed?.enableWebhook ? "#2ecc7144" : "#e74c3c22"}`,
                  color: parsed?.enableWebhook ? "#2ecc71" : "#475569",
                }}>
                  {parsed?.enableWebhook ? "● Enabled" : "○ Disabled"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}