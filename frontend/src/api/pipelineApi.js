import { apiFetch } from "./index"

export async function fetchPipelineRun(runId) {
  const res = await apiFetch(`/api/pipeline/${runId}`)
  if (!res || !res.ok) throw new Error("Failed to fetch pipeline run")
  return res.json()
}

export async function fetchLatestPipelineRun(serviceName, environment) {
  const res = await apiFetch(`/api/pipeline/service/${serviceName}/${environment}`)
  if (!res || !res.ok) throw new Error("No pipeline runs found")
  return res.json()
}

/**
 * streamPipelineRun — SSE connection for live pipeline updates.
 *
 * EventSource cannot set the Authorization header, and HttpOnly cookies
 * are NOT reliably sent cross-origin (e.g. React dev server on :5173
 * talking to backend on :8080).
 *
 * Solution: fetch a short-lived token from /auth/me (which works because
 * apiFetch uses credentials:include), then pass it as ?token= in the
 * SSE URL. The backend already allows ?token= for SSE paths only.
 *
 * Returns a cleanup function — caller must call it on unmount.
 */
export async function streamPipelineRun(runId, { onSnapshot, onStageUpdated, onRunUpdated, onCompleted, onError }) {
  // Get the current auth token by hitting /auth/me with cookie credentials.
  // We need the raw token string for the SSE ?token= param.
  // Since the JWT is HttpOnly, we get a short-lived representation via
  // a dedicated SSE-token endpoint if available, otherwise we fall back
  // to using withCredentials for same-origin setups.
  //
  // IMPORTANT: The backend's ExtractTokenFromRequest reads ?token= only
  // for SSE paths (/stream suffix), so this is safe.

  let sseToken = null
  try {
    // Try to get token from /auth/sse-token if backend provides it
    const tokenRes = await fetch("/api/auth/sse-token", { credentials: "include" })
    if (tokenRes.ok) {
      const data = await tokenRes.json()
      sseToken = data.token
    }
  } catch {
    // /auth/sse-token not available — fall back below
  }

  // Build the SSE URL
  const url = sseToken
    ? `/api/pipeline/${runId}/stream?token=${encodeURIComponent(sseToken)}`
    : `/api/pipeline/${runId}/stream`

  const es = new EventSource(url, { withCredentials: true })
  let intentionalClose = false

  es.addEventListener("run_snapshot",  e => {
    try { onSnapshot?.(JSON.parse(e.data)) } catch {}
  })
  es.addEventListener("stage_updated", e => {
    try { onStageUpdated?.(JSON.parse(e.data)) } catch {}
  })
  es.addEventListener("run_updated",   e => {
    try { onRunUpdated?.(JSON.parse(e.data)) } catch {}
  })
  es.addEventListener("run_completed", e => {
    intentionalClose = true
    try { onCompleted?.(JSON.parse(e.data)) } catch {}
    es.close()
  })

  es.onerror = err => {
    if (intentionalClose) return
    // CLOSED = no auto-reconnect will happen → report the error
    if (es.readyState === EventSource.CLOSED) {
      onError?.(err)
    }
    // CONNECTING = EventSource is already retrying, do nothing
  }

  return () => {
    intentionalClose = true
    es.close()
  }
}
