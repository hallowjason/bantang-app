import { apiGet, apiPost, apiPut } from './client'
import type { Member, ClassMemberWithName, Attendance } from '../../types'

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

export async function addMember(
  data: Omit<Member, 'id'>,
  classId: string,
  _userId: string,
): Promise<string> {
  const result = await apiPost<{ id: string }>('/api/members', { ...data, classId })
  return result.id
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
