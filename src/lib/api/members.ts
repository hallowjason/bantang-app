import { apiGet, apiPost, apiPut, apiFetch } from './client'
import type { Member, ClassMemberWithName, Attendance, Class } from '../../types'

export async function getClassInfo(classId: string): Promise<Class | null> {
  try {
    return await apiGet<Class>(`/api/classes/${classId}`)
  } catch {
    return null
  }
}

export async function getMembers(classId: string): Promise<Member[]> {
  return apiGet<Member[]>(`/api/members?classId=${classId}`)
}

export async function getMemberById(memberId: string): Promise<Member | null> {
  try {
    return await apiGet<Member>(`/api/members/${memberId}`)
  } catch {
    return null
  }
}

export interface IccfSyncResult {
  status: string
  iccfMemberId?: string
  message?: string
}

export async function addMember(
  data: Omit<Member, 'id'>,
  classId: string,
  _userId: string,
  iccfOptions?: { sessionId: string; classCode: string },
): Promise<{ id: string; iccf: IccfSyncResult | null }> {
  const body: Record<string, unknown> = { ...data, classId }
  if (iccfOptions) {
    body.iccfSessionId = iccfOptions.sessionId
    body.iccfClassCode = iccfOptions.classCode
  }
  const result = await apiPost<{ id: string; iccf: IccfSyncResult | null }>('/api/members', body)
  return result
}

export async function updateMember(
  memberId: string,
  data: Partial<Omit<Member, 'id'>>,
): Promise<void> {
  await apiPut(`/api/members/${memberId}`, data)
}

export async function removeMemberFromClass(
  classId: string,
  memberId: string,
  _removedBy: string,
  removeReason: string,
): Promise<void> {
  await apiPost(`/api/members/${memberId}/remove-from-class`, { classId, removeReason })
}

export async function getMemberAttendanceCount(memberId: string): Promise<number> {
  const data = await apiGet<{ records: Attendance[]; totalCount: number }>(
    `/api/members/${memberId}/attendance`,
  )
  return data.totalCount
}

export async function getMemberAttendance(memberId: string): Promise<Attendance[]> {
  const data = await apiGet<{ records: Attendance[]; totalCount: number }>(
    `/api/members/${memberId}/attendance`,
  )
  return data.records
}

export async function getMemberActiveClasses(memberId: string): Promise<ClassMemberWithName[]> {
  return apiGet<ClassMemberWithName[]>(`/api/members/${memberId}/active-classes`)
}

export async function repairIccfSync(
  memberId: string,
  sessionId: string,
  classCode: string,
): Promise<IccfSyncResult> {
  const res = await apiFetch(`/api/members/${memberId}/iccf-sync`, {
    method: 'POST',
    body: JSON.stringify({ iccfSessionId: sessionId, iccfClassCode: classCode }),
  })
  const body = await res.json()
  if (res.status === 401) return { status: 'session_expired', message: body.error }
  if (!body.success) throw new Error(body.error ?? 'API error')
  return body.data as IccfSyncResult
}
