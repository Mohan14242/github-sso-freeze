import { apiFetch } from "./index"

export async function fetchFreezeStatus(serviceName) {
  const res = await apiFetch(`/api/services/${serviceName}/freeze-status`)
  if (!res || !res.ok) throw new Error("Failed to fetch freeze status")
  return res.json()
}

export async function freezeDeployment(serviceName, environment, reason = "") {
  const res = await apiFetch(`/api/services/${serviceName}/freeze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment, reason }),
  })
  if (!res || !res.ok) {
    const text = await res?.text()
    throw new Error(text || "Failed to freeze deployment")
  }
  return res.json()
}

export async function unfreezeDeployment(serviceName, environment) {
  const res = await apiFetch(`/api/services/${serviceName}/unfreeze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment }),
  })
  if (!res || !res.ok) {
    const text = await res?.text()
    throw new Error(text || "Failed to unfreeze deployment")
  }
  return res.json()
}
