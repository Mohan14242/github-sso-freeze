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
 * streamPipelineRun — SSE connection for live pipeline updates
 *
 * - Uses JWT from sessionStorage
 * - Returns cleanup function
 * - Handles intentional close
 * - Safe JSON parsing
 */

export function streamPipelineRun(
  runId,
  { onSnapshot, onStageUpdated, onRunUpdated, onCompleted, onError }
) {
  const token = sessionStorage.getItem("jwt_token")

  const url = token
    ? `/api/pipeline/${runId}/stream?token=${encodeURIComponent(token)}`
    : `/api/pipeline/${runId}/stream`

  const es = new EventSource(url, { withCredentials: true })

  let intentionalClose = false

  es.addEventListener("run_snapshot", (e) => {
    try {
      const data = JSON.parse(e.data)
      onSnapshot?.(data)
    } catch (err) {
      console.error("Invalid run_snapshot event", err)
    }
  })

  es.addEventListener("stage_updated", (e) => {
    try {
      const data = JSON.parse(e.data)
      onStageUpdated?.(data)
    } catch (err) {
      console.error("Invalid stage_updated event", err)
    }
  })

  es.addEventListener("run_updated", (e) => {
    try {
      const data = JSON.parse(e.data)
      onRunUpdated?.(data)
    } catch (err) {
      console.error("Invalid run_updated event", err)
    }
  })

  es.addEventListener("run_completed", (e) => {
    intentionalClose = true
    try {
      const data = JSON.parse(e.data)
      onCompleted?.(data)
    } catch (err) {
      console.error("Invalid run_completed event", err)
    }
    es.close()
  })

  es.onerror = (err) => {
    if (intentionalClose) return
    console.error("SSE connection error:", err)
    onError?.(err)
    es.close()
  }

  return () => {
    intentionalClose = true
    es.close()
  }
}