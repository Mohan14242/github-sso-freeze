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

// SSE — returns an EventSource and cleanup function
export function streamPipelineRun(runId, { onStageUpdated, onRunUpdated, onCompleted, onSnapshot, onError }) {
  const token = sessionStorage.getItem("jwt_token")
  const url   = `/api/pipeline/${runId}/stream?token=${encodeURIComponent(token)}`

  const es = new EventSource(url, { withCredentials: true })
  let intentionalClose = false  // ← add this

  es.addEventListener("run_snapshot",  e => onSnapshot?.(JSON.parse(e.data)))
  es.addEventListener("stage_updated", e => onStageUpdated?.(JSON.parse(e.data)))
  es.addEventListener("run_updated",   e => onRunUpdated?.(JSON.parse(e.data)))
  es.addEventListener("run_completed", e => {
    intentionalClose = true      // ← mark before closing
    onCompleted?.(JSON.parse(e.data))
    es.close()
  })

  es.onerror = (err) => {
    if (intentionalClose) return  // ← ignore close-triggered errors
    onError?.(err)
    es.close()
  }

  return () => {
    intentionalClose = true       // ← also mark when caller cleans up
    es.close()
  }
}