import { apiFetch } from "./index"

export async function fetchServices() {
  const res = await apiFetch("/api/services")
  if (!res || !res.ok) throw new Error("Failed to fetch services")
  return res.json()
}

export async function fetchServiceDashboard(serviceName) {
  const res = await apiFetch(`/api/servicesdashboard/${serviceName}/dashboard`, {
    headers: { Accept: "application/json" },
  })
  if (!res || !res.ok) throw new Error("Failed to fetch service dashboard")
  return res.json()
}

export async function deployService(serviceName, environment) {
  const res = await apiFetch(`/api/deploy-services/${serviceName}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment }),
  })

  if (!res) throw new Error("No response from server")

  let data = null
  try { data = await res.json() } catch {}

  if (!res.ok) {
    const err = new Error(data?.error || "Deployment failed")
    err.runId = data?.runId ?? data?.run_id ?? null
    throw err
  }

  return data
}

export async function fetchPlatformStats() {
  const res = await apiFetch("/api/stats")
  if (!res || !res.ok) throw new Error("Failed to fetch stats")
  return res.json()
}
