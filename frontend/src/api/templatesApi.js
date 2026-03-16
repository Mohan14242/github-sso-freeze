import { apiFetch } from "./index"

export async function fetchTemplateVersions(filters = {}) {
  const params = new URLSearchParams()
  if (filters.status)  params.set("status",  filters.status)
  if (filters.runtime) params.set("runtime", filters.runtime)
  const q = params.toString() ? `?${params.toString()}` : ""
  const res = await apiFetch(`/api/template-versions${q}`)
  if (!res || !res.ok) throw new Error("Failed to fetch template versions")
  return res.json()
}

export async function createTemplateVersion(data) {
  const res = await apiFetch("/api/template-versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res || !res.ok) {
    const text = await res?.text()
    throw new Error(text || "Failed to create template version")
  }
  return res.json()
}

export async function deprecateTemplateVersion(id) {
  const res = await apiFetch(`/api/template-versions/${id}/deprecate`, { method: "POST" })
  if (!res || !res.ok) {
    const text = await res?.text()
    throw new Error(text || "Failed to deprecate template version")
  }
  return res.json()
}

export async function releaseTemplateVersion(id) {
  const res = await apiFetch(`/api/template-versions/${id}/release`, { method: "POST" })
  if (!res || !res.ok) {
    const text = await res?.text()
    throw new Error(text || "Failed to release template version")
  }
  return res.json()
}
