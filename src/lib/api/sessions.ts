import { apiGet, apiPost, apiPut } from './client'
import type { Session } from '../../types'

export async function getSession(
  classId: string,
  date: string,
): Promise<Session | null> {
  return apiGet<Session | null>(`/api/sessions?classId=${classId}&date=${date}`)
}

export async function getOrCreateSession(
  classId: string,
  date: string,
  _userId: string,
): Promise<Session> {
  return apiPost<Session>('/api/sessions/get-or-create', { classId, date })
}

export async function finalizeSession(
  classId: string,
  date: string,
  _userId: string,
): Promise<void> {
  const id = `${classId}_${date}`
  await apiPut(`/api/sessions/${id}/finalize`)
}

export async function reopenSession(classId: string, date: string): Promise<void> {
  const id = `${classId}_${date}`
  await apiPut(`/api/sessions/${id}/reopen`)
}

/**
 * Poll-based substitute for onSnapshot.
 */
export function subscribeToSession(
  classId: string,
  date: string,
  onData: (session: Session | null) => void,
): () => void {
  const doFetch = () =>
    getSession(classId, date).then(onData).catch(console.error)

  doFetch()
  const id = setInterval(doFetch, 4000)
  return () => clearInterval(id)
}
