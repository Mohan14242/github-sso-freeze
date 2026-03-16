import { apiFetch } from "./index"

export async function fetchServiceCreationRequests(status = "") {
  const query = status ? `?status=${status}` : ""
  const res = await apiFetch(`/api/service-creation-requests${query}`)
  if (!res || !res.ok) throw new Error("Failed to fetch service creation requests")
  return res.json()
}

export async function approveServiceCreation(id) {
  const res = await apiFetch(`/api/service-creation-requests/${id}/approve`, {
    method: "POST",
  })
  if (!res || !res.ok) {
    const text = await res?.text()
    throw new Error(text || "Approval failed")
  }
  return res.json()
}

export async function rejectServiceCreation(id, reason = "") {
  const res = await apiFetch(`/api/service-creation-requests/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  })
  if (!res || !res.ok) throw new Error("Rejection failed")
  return res.json()
}
