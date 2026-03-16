import { apiFetch } from "./index"

export async function fetchArtifactsByEnv(serviceName, environment) {
  const res = await apiFetch(
    `/api/artifact-by-env/${serviceName}/artifacts?environment=${environment}`
  )
  if (!res || !res.ok) throw new Error("Failed to fetch artifacts")
  return res.json()
}

export async function rollbackService(serviceName, payload) {
  const res = await apiFetch(`/api/rollback-services/${serviceName}/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res || !res.ok) throw new Error("Rollback failed")
  return res.json()
}

export async function fetchServiceEnvironments(serviceName) {
  const res = await apiFetch(`/api/services/${serviceName}/environments`)
  if (!res || !res.ok) throw new Error("Failed to fetch environments")
  return res.json()
}

export async function createService(payload) {
  const res = await apiFetch("/api/create-service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res || !res.ok) throw new Error("API error")
  return res.json()
}
