import { auth } from '../firebase/config'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await auth.currentUser?.getIdToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return fetch(`${API_URL}${path}`, { ...options, headers })
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path)
  const body = await res.json()
  if (!body.success) throw new Error(body.error ?? 'API error')
  return body.data as T
}

export async function apiPost<T>(path: string, data?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    body: data !== undefined ? JSON.stringify(data) : undefined,
  })
  const body = await res.json()
  if (!body.success) throw new Error(body.error ?? 'API error')
  return body.data as T
}

export async function apiPut<T>(path: string, data?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: 'PUT',
    body: data !== undefined ? JSON.stringify(data) : undefined,
  })
  const body = await res.json()
  if (!body.success) throw new Error(body.error ?? 'API error')
  return body.data as T
}

export async function apiDelete(path: string): Promise<void> {
  const res = await apiFetch(path, { method: 'DELETE' })
  const body = await res.json()
  if (!body.success) throw new Error(body.error ?? 'API error')
}

/** Upload a file (multipart/form-data) */
export async function apiUpload(path: string, file: File): Promise<string> {
  const token = await auth.currentUser?.getIdToken()
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })
  const body = await res.json()
  if (!body.success) throw new Error(body.error ?? 'Upload failed')
  // Return full URL
  return `${API_URL}${body.data.url}`
}
