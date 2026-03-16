/**
 * apiFetch — fetch wrapper that:
 *   1. Sends HttpOnly cookie automatically via credentials: "include"
 *   2. On 401 redirects to /login
 *   3. Never touches sessionStorage or localStorage
 */
export async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}) },
    credentials: "include",
  })

  if (res.status === 401) {
    window.location.href = "/login"
    return null
  }

  return res
}

/**
 * apiFetchJSON — parses JSON and throws a descriptive Error on non-2xx.
 */
export async function apiFetchJSON(url, options = {}) {
  const res = await apiFetch(url, options)
  if (!res) return null

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try { message = (await res.text()) || message } catch {}
    throw new Error(message)
  }

  return res.json()
}
