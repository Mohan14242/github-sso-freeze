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
 * streamPipelineRun — SSE with proper intentional-close handling.
 *
 * Uses withCredentials: true so the HttpOnly cookie is sent with the SSE
 * connection (same-origin setup). If cross-origin is needed, the backend
 * must also accept a ?token= query param for SSE paths.
 *
 * Returns a cleanup function — call it on component unmount.
 */
export function streamPipelineRun(runId, {
  onSnapshot, onStageUpdated, onRunUpdated, onCompleted, onError,
}) {
  const url = `/api/pipeline/${runId}/stream`
  const es  = new EventSource(url, { withCredentials: true })
  let intentionalClose = false

  es.addEventListener("run_snapshot",  e => {
    try { onSnapshot?.(JSON.parse(e.data)) } catch (err) { console.error("snapshot parse error", err) }
  })
  es.addEventListener("stage_updated", e => {
    try { onStageUpdated?.(JSON.parse(e.data)) } catch (err) { console.error("stage parse error", err) }
  })
  es.addEventListener("run_updated",   e => {
    try { onRunUpdated?.(JSON.parse(e.data)) } catch (err) { console.error("run update parse error", err) }
  })
  es.addEventListener("run_completed", e => {
    intentionalClose = true
    try { onCompleted?.(JSON.parse(e.data)) } catch (err) { console.error("completed parse error", err) }
    es.close()
  })

  es.onerror = err => {
    if (intentionalClose) return
    // EventSource.CLOSED means it will not reconnect — call onError
    if (es.readyState === EventSource.CLOSED) {
      onError?.(err)
    }
    // EventSource.CONNECTING means it's auto-reconnecting — do nothing
  }

  return () => {
    intentionalClose = true
    es.close()
  }
}
