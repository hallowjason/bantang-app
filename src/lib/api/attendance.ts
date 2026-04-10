import { apiGet, apiPost, apiPut } from './client'
import type { Attendance, AttendanceStatus } from '../../types'

export async function getClassAttendance(
  classId: string,
  date: string,
): Promise<Attendance[]> {
  return apiGet<Attendance[]>(`/api/attendance?classId=${classId}&date=${date}`)
}

/**
 * Poll-based substitute for onSnapshot.
 * Returns a cleanup function (same API as Firebase's unsubscribe).
 */
export function subscribeToClassAttendance(
  classId: string,
  date: string,
  onData: (records: Attendance[]) => void,
): () => void {
  const doFetch = () =>
    getClassAttendance(classId, date).then(onData).catch(console.error)

  doFetch()
  const id = setInterval(doFetch, 4000)
  return () => clearInterval(id)
}

export async function setAttendanceRecord(params: {
  classId: string
  memberId: string
  date: string
  status: AttendanceStatus
  note?: string
  userId: string
}): Promise<void> {
  const { classId, memberId, date, status, note, userId } = params
  const id = `${classId}_${memberId}_${date}`
  await apiPut(`/api/attendance/${id}`, { classId, memberId, date, status, note, userId })
}

export async function initializeAbsentForAll(params: {
  classId: string
  memberIds: string[]
  date: string
  userId: string
}): Promise<void> {
  await apiPost('/api/attendance/init-absent', params)
}
