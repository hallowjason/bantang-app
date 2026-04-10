import { apiGet, apiPost, apiPut } from './client'
import type { AppUser, Class, UserRole } from '../../types'

export async function checkHeadLeaderExists(): Promise<boolean> {
  const data = await apiGet<{ exists: boolean }>('/api/admin/check-head-leader')
  return data.exists
}

export async function getAllUsers(): Promise<AppUser[]> {
  return apiGet<AppUser[]>('/api/admin/users')
}

export async function updateUserProfile(
  userId: string,
  data: { role?: UserRole; classId?: string },
): Promise<void> {
  await apiPut(`/api/admin/users/${userId}`, data)
}

export async function getAllClasses(): Promise<Class[]> {
  return apiGet<Class[]>('/api/admin/classes')
}

export async function createClass(name: string): Promise<Class> {
  return apiPost<Class>('/api/admin/classes', { name })
}

export async function updateClassName(classId: string, name: string): Promise<void> {
  await apiPut(`/api/admin/classes/${classId}`, { name })
}

export async function updateClassSheetConfig(
  classId: string,
  sheetTabName: string,
  sheetClassLabel: string,
): Promise<void> {
  await apiPut(`/api/admin/classes/${classId}`, { sheetTabName, sheetClassLabel })
}
