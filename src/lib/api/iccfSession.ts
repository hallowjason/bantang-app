import { apiPost, apiFetch, apiGet } from './client'

export interface IccfProfile {
  name: string
  area: string
}

export interface IccfClassEntry {
  classCode: string
  className: string
}

export interface IccfSessionInfo {
  sessionId: string
  iccfAccount: string
  profile: IccfProfile | null
  classes: IccfClassEntry[]
  lastUsedAt: string
  expiresAt: string
}

export interface IccfLoginResult {
  sessionId: string
  profile: IccfProfile | null
  classes: IccfClassEntry[]
  forceKicked: boolean
  expiresAt: string
}

export async function iccfLogin(account: string, password: string): Promise<IccfLoginResult> {
  return apiPost<IccfLoginResult>('/api/iccf/session', { account, password })
}

export async function iccfGetCurrentSessions(): Promise<IccfSessionInfo[]> {
  return apiGet<IccfSessionInfo[]>('/api/iccf/session/current')
}

export async function iccfLogout(sessionId: string): Promise<void> {
  const res = await apiFetch(`/api/iccf/session/${sessionId}`, { method: 'DELETE' })
  const body = await res.json()
  if (!body.success) throw new Error(body.error ?? 'Logout failed')
}

export async function iccfTouch(sessionId: string): Promise<void> {
  await apiPost(`/api/iccf/session/${sessionId}/touch`)
}
