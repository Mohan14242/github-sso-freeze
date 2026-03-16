import { apiFetch } from "./index"

export async function fetchAuditLogs(filters = {}, page = 1) {
  const params = new URLSearchParams()
  if (filters.actor)        params.set("actor",        filters.actor)
  if (filters.environment)  params.set("environment",  filters.environment)
  if (filters.resourceName) params.set("resourceName", filters.resourceName)
  if (filters.action)       params.set("action",       filters.action)
  if (filters.status)       params.set("status",       filters.status)
  if (filters.from)         params.set("from",         filters.from)
  if (filters.to)           params.set("to",           filters.to)
  params.set("page", page)

  const res = await apiFetch(`/api/audit-logs?${params.toString()}`)
  if (!res || !res.ok) throw new Error("Failed to fetch audit logs")
  return res.json()
}
