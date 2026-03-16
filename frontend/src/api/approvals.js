import { apiFetch } from "./index"

export async function fetchProdApprovals() {
  const res = await apiFetch("/api/approvals?environment=prod")
  if (!res || !res.ok) throw new Error("Failed to fetch approvals")
  return res.json()
}

export async function fetchApprovalById(approvalId) {
  const res = await apiFetch(`/api/approvals/${approvalId}`)
  if (!res?.ok) throw new Error("Failed to fetch approval")
  return res.json()
}

export async function approveDeployment(id) {
  const res = await apiFetch(`/api/approvals/${id}/approve`, { method: "POST" })
  if (!res?.ok) throw new Error("Failed to approve deployment")
  return res.json()
}

export async function rejectDeployment(id, reason = "") {
  const res = await apiFetch(`/api/approvals/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  })
  if (!res?.ok) throw new Error("Failed to reject deployment")
  return res.json()
}
